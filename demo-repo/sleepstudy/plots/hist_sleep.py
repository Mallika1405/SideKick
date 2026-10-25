import matplotlib.pyplot as plt

def plot_hist_sleep(df, out_path):
    fig, ax = plt.subplots()
    ax.hist(df.sleep_hours, bins=20)
    ax.set_xlabel('Sleep (hours)')
    fig.savefig(out_path, dpi=150, bbox_inches='tight')
    plt.close(fig)
