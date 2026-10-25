from sklearn.metrics import r2_score, mean_absolute_error

def evaluate(model, X_test, y_test) -> dict:
    pred = model.predict(X_test)
    return {'r2': r2_score(y_test, pred), 'mae': mean_absolute_error(y_test, pred)}
