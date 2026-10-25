from sklearn.model_selection import cross_val_score

def cv_r2(model, X_train, y_train, folds=5) -> float:
    return float(cross_val_score(model, X_train, y_train, cv=folds, scoring='r2').mean())
