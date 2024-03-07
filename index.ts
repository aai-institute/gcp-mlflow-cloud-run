import * as docker from "@pulumi/docker";
import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

// Provider configuration
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");
const location = gcpConfig.require("region");

// Enable service APIs
const apis = [
  "compute",
  "artifactregistry",
  "run",
  "sqladmin",
  "secretmanager",
];
for (const api of apis) {
  new gcp.projects.Service(`${api} API`, {
    service: `${api}.googleapis.com`,
    disableDependentServices: true,
    disableOnDestroy: false,
  });
}

// Artifact Registry repository for container images
const repo = new gcp.artifactregistry.Repository("repository", {
  repositoryId: "images",
  format: "DOCKER",
});
const repoUrl = pulumi.interpolate`${repo.location}-docker.pkg.dev/${repo.project}/${repo.repositoryId}`;

// MLflow container image
const image = new docker.Image("mlflow", {
  imageName: pulumi.interpolate`${repoUrl}/mlflow`,
  build: {
    context: "docker/mlflow",
    platform: "linux/amd64",
  },
});
export const imageDigest = image.repoDigest;

// Storage Bucket for artifacts
const bucketSuffix = new random.RandomId("artifact bucket suffix", {
  byteLength: 4,
});
const artifactBucket = new gcp.storage.Bucket("artifacts", {
  name: pulumi.concat("mlflow-artifacts-", bucketSuffix.hex),
  location: "EU",
  uniformBucketLevelAccess: true,
  publicAccessPrevention: "enforced",
});
export const bucket = artifactBucket.name;

// Cloud SQL instance for tracking backend storage and authentication data
const dbInstance = new gcp.sql.DatabaseInstance("mlflow", {
  databaseVersion: "POSTGRES_15",
  deletionProtection: false,
  settings: {
    tier: "db-f1-micro",
    availabilityType: "ZONAL",
    activationPolicy: "ALWAYS",
    databaseFlags: [{ name: "max_connections", value: "50" }],
  },
});

const trackingDb = new gcp.sql.Database("tracking", {
  instance: dbInstance.name,
  name: "mlflow",
});

const authDb = new gcp.sql.Database("auth", {
  instance: dbInstance.name,
  name: "mlflow-auth",
});

const dbPassword = new random.RandomPassword("mlflow", {
  length: 16,
  special: false,
});
const user = new gcp.sql.User("mlflow", {
  instance: dbInstance.name,
  name: "mlflow",
  password: dbPassword.result,
});

export const trackingDbInstanceUrl = pulumi.interpolate`postgresql://${user.name}:${user.password}@/${trackingDb.name}?host=/cloudsql/${dbInstance.connectionName}`;
export const authDbInstanceUrl = pulumi.interpolate`postgresql://${user.name}:${user.password}@/${authDb.name}?host=/cloudsql/${dbInstance.connectionName}`;

// Secret Manager
const authSecret = new gcp.secretmanager.Secret("mlflow-basic-auth-conf", {
  secretId: "basic_auth-ini",
  replication: { auto: {} },
});

const adminPw = new random.RandomPassword("mlflow-admin", {
  length: 16,
  special: false,
});
export const adminUsername = "admin";
export const adminPassword = adminPw.result.apply((pw) => pw);

const authSecretVersion = new gcp.secretmanager.SecretVersion(
  "mlflow-auth-conf",
  {
    secret: authSecret.id,
    secretData: pulumi.interpolate`[mlflow]
default_permission = READ
database_uri = ${authDbInstanceUrl}
admin_username = ${adminUsername}
admin_password=${adminPassword}
authorization_function = mlflow.server.auth:authenticate_request_basic_auth
`,
  }
);

// Service Account and IAM role bindings
const sa = new gcp.serviceaccount.Account("mlflow", {
  accountId: "mlflow",
});
const roles = ["roles/cloudsql.client", "roles/secretmanager.secretAccessor"];
for (const role of roles) {
  new gcp.projects.IAMMember(role, {
    project: project,
    role,
    member: pulumi.concat("serviceAccount:", sa.email),
  });
}

const iam = new gcp.storage.BucketIAMMember("artifacts access", {
  bucket: bucket,
  member: pulumi.concat("serviceAccount:", sa.email),
  role: "roles/storage.objectUser",
});

// Cloud Run
const command = [
  "mlflow",
  "server",
  "--host",
  "0.0.0.0",
  "--port",
  "5000",
  "--artifacts-destination",
  artifactBucket.name.apply((name) => `gs://${name}`),
  "--backend-store-uri",
  trackingDbInstanceUrl.apply((s) => s),
  "--app-name",
  "basic-auth",
];

const service = new gcp.cloudrunv2.Service("mlflow", {
  location,
  template: {
    serviceAccount: sa.email,
    volumes: [
      {
        name: "auth-config",
        secret: {
          secret: authSecret.id,
        },
      },
      {
        name: "cloudsql",
        cloudSqlInstance: {
          instances: [dbInstance.connectionName],
        },
      },
    ],
    containers: [
      {
        image: imageDigest,
        commands: command,
        volumeMounts: [
          {
            name: "auth-config",
            mountPath: "/secrets",
          },
          {
            name: "cloudsql",
            mountPath: "/cloudsql",
          },
        ],
        ports: [{ containerPort: 5000 }],
        envs: [
          {
            name: "MLFLOW_AUTH_CONFIG_PATH",
            value: pulumi.interpolate`/secrets/${authSecret.secretId}`,
          },
        ],
        resources: {
          limits: {
            memory: "1024Mi",
            cpu: "1",
          },
          startupCpuBoost: true,
        },
      },
    ],
  },
});

export const serviceUrl = service.uri;

// Allow unauthenticated public access to the service endpoint
new gcp.cloudrunv2.ServiceIamBinding("mlflow-public-access", {
  name: service.name,
  project,
  location,
  role: "roles/run.invoker",
  members: ["allUsers"],
});
