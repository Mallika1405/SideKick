from sleepstudy.cleaning import drop_duplicates, fix_types, dates, categories, sleep_range, outliers, missing, pii

def clean_all(df):
    for step in (pii.pii, dates.dates, fix_types.fix_types, drop_duplicates.drop_duplicates,
                 categories.categories, sleep_range.sleep_range, missing.missing, outliers.outliers):
        df = step(df)
    return df.reset_index(drop=True)
