import matplotlib.pyplot as plt

def plot_importance(df, out_path):
    fig, ax = plt.subplots()
    ax.barh(df.feature, df.importance)
    fig.savefig(out_path, dpi=150, bbox_inches='tight')
    plt.close(fig)
