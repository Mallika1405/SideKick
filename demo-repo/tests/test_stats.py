from sleepstudy.stats.multiple_testing import bonferroni

def test_bonferroni_caps_at_one():
    assert bonferroni([0.4, 0.01]) == [0.8, 0.02]
