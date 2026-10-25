import matplotlib.pyplot as plt

def plot_scatter(df, out_path):
    fig, ax = plt.subplots()
    ax.scatter(df.sleep_hours, df.exam_score, alpha=0.5)
    ax.set_xlabel('Sleep (hours)'); ax.set_ylabel('Exam score')
    fig.savefig(out_path, dpi=150, bbox_inches='tight')
    plt.close(fig)
