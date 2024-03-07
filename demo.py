import mlflow
import pandas as pd
from sklearn import datasets
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

mlflow.autolog()
mlflow.start_run()

# Data preprocessing
X, y = datasets.load_iris(return_X_y=True, as_frame=True)
X_train, X_test, y_train, y_test = train_test_split(X, y)

# Model training
model = DecisionTreeClassifier()
model.fit(X_train, y_train)

# Model evaluation - see https://mlflow.org/docs/latest/models.html#model-evaluation
eval_df = pd.concat([X_test, y_test], axis=1)
eval_data = mlflow.data.from_pandas(eval_df, targets=y_test.name, name="test")
result = mlflow.evaluate(
    model=model.predict,
    data=eval_data,
    model_type="classifier",
)
print(result.metrics)
