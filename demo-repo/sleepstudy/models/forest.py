from sklearn.ensemble import RandomForestRegressor
from sleepstudy.config import CONFIG

def fit_forest(X_train, y_train):
    return RandomForestRegressor(n_estimators=200, random_state=CONFIG.random_seed).fit(X_train, y_train)
