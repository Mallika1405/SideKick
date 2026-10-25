from sklearn.linear_model import LinearRegression

def fit_linear(X_train, y_train):
    return LinearRegression().fit(X_train, y_train)
