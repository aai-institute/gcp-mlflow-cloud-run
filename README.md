# Serverless MLflow Tracking in Google Cloud Run

This repository accompanies the blog post on how to set up serverless MLflow experiment tracking infrastructure using Google Cloud Run and Pulumi.
You can find the full article on [LinkedIn](TODO).

## Deploying to Google Cloud

### Prerequisites

The following prerequisites are required to deploy the experiment tracking infrastructure to Google Cloud:

- [Pulumi](https://www.pulumi.com/) for provisioning the infrastructure, plus
  - [Node.js](https://nodejs.org/en) for the Pulumi TypeScript runtime
  - [Docker](https://www.docker.com/) for building and testing the MLflow container image
  - [Google Cloud SDK](https://cloud.google.com/sdk) for access to Google Cloud Platform (make sure to follow the [authorization guide](https://cloud.google.com/sdk/docs/authorizing#authorizing_with_a_user_account))
- Optionally: [Python](https://www.python.org/) (at least 3.9) for the MLflow example experiments

Additionally, you need a [Google Cloud Platform](https://cloud.google.com) account and access to a project (with appropriate permissions).
If you do not have an account already, you can get [$300 in free credits when you sign up](https://cloud.google.com/free).

In case you are creating a new Google Cloud project, you need to manually enable the [Compute Engine API](https://console.cloud.google.com/apis/library/compute.googleapis.com) in Cloud Console before you can provision the rest of the infrastructure using Pulumi.

### Provisioning

After you have cloned this repository, open a terminal inside the working copy.

First, we select the `dev` Pulumi stack and set two configuration variables for the Pulumi GCP provider based on your GCP setup:

```
$ pulumi stack select dev
$ pulumi config gcp:project "<your GCP project ID>"
$ pulumi config gcp:region "europe-west3"  # change as desired
```

Then, we are ready to provision the infrastructure:

```
$ pulumi up
```

After the operation completes (this will take a few minutes), you can examine the stack outputs to obtain the MLflow service URL and authentication credentials:

```
$ pulumi stack output --show-secrets
```

### Running the demo ML experiment

The blog post walks you through a small ML experiment that makes use of the deployed MLflow experiment tracking server.

This repository contains the source code of the example (`demo.py`) and its Python package requirements (`requirements.txt`).

Execute the following commands to set up a Python virtual environment with the prerequisite packages, obtain MLflow user credentials from the Pulumi stack outputs, and run the ML experiment code:

```shell
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export MLFLOW_TRACKING_URI=$(pulumi stack output serviceUrl)
export MLFLOW_TRACKING_USERNAME=$(pulumi stack output adminUsername)
export MLFLOW_TRACKING_PASSWORD=$(pulumi stack output --show-secrets adminPassword)

python demo.py
```

Please see the blog post for additional explanations of the code and its results.
