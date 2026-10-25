import pandas as pd
from sleepstudy.cleaning.sleep_range import sleep_range

def test_sleep_range_drops_impossible_values():
    df = pd.DataFrame({'sleep_hours': [1.0, 7.0, 20.0]})
    assert list(sleep_range(df).sleep_hours) == [7.0]
