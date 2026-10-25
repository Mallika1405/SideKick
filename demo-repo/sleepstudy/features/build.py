from sleepstudy.features import sleep_debt, sleep_bins, study_load, caffeine_level, gpa_band, weekday_sleep, stress_index, major_dummies

FEATURE_COLUMNS = ['sleep_hours', 'sleep_debt', 'study_load', 'caffeine_level', 'gpa', 'stress_index', 'weekend_gap']

def build_features(df):
    for fn in (sleep_debt.add_sleep_debt, sleep_bins.add_sleep_bins, study_load.add_study_load,
               caffeine_level.add_caffeine_level, gpa_band.add_gpa_band, weekday_sleep.add_weekday_sleep,
               stress_index.add_stress_index, major_dummies.add_major_dummies):
        df = fn(df)
    return df
