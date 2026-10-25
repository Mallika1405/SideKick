import sys
from sleepstudy.io.load_survey import load_survey
from sleepstudy.cleaning.pipeline import clean_all
from sleepstudy.features.build import build_features
from sleepstudy.models.split import split_data
from sleepstudy.models.ridge import fit_ridge
from sleepstudy.models.evaluate import evaluate

def run(path: str) -> dict:
    df = build_features(clean_all(load_survey(path)))
    X_train, X_test, y_train, y_test = split_data(df)
    model = fit_ridge(X_train, y_train)
    return evaluate(model, X_test, y_test)

if __name__ == '__main__':
    print(run(sys.argv[1]))
