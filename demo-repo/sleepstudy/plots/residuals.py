import matplotlib.pyplot as plt

def plot_residuals(df, out_path):
    fig, ax = plt.subplots()
    ax.scatter(df.pred, df.exam_score - df.pred, alpha=0.5)
    ax.axhline(0, color='k')
    fig.savefig(out_path, dpi=150, bbox_inches='tight')
    plt.close(fig)
