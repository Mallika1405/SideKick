import matplotlib.pyplot as plt

def plot_box_by_bin(df, out_path):
    fig, ax = plt.subplots()
    df.boxplot(column='exam_score', by='sleep_bin', ax=ax)
    fig.savefig(out_path, dpi=150, bbox_inches='tight')
    plt.close(fig)
