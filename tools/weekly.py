"""Weekly run on the owner's PC (the GitHub job can't do these two things).

1. NSW buoys: Manly Hydraulics Lab blocks GitHub's servers, but answers from a home
   connection and keeps 7 days of readings. Running tools/verify.py here once a week
   fills in Byron Bay and Sydney, then the scores are committed and pushed.
2. The private Reality Check page can't read GitHub, so this writes the document it
   reads to .mock/reality-seed.json (gitignored). The scheduled Claude task then
   saves that file to the page's store as stats/accuracy.

Usage: python tools/weekly.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / '.mock' / 'reality-seed.json'
DATA = ['data/verify.json', 'data/track.json', 'data/accuracy.json']


def git(*args, check=True):
    print('git', *args, flush=True)
    return subprocess.run(['git', *args], cwd=ROOT, check=check, text=True, capture_output=True)


def seed():
    src = (ROOT / 'config.js').read_text(encoding='utf-8')
    q = r"""(?:'((?:[^'\\]|\\.)*)'|"([^"]*)")"""
    spots = [[m[1], (m[4] or m[5]).replace("\\'", "'"), m[6]] for m in
             re.finditer(r"\{ id: '([^']+)', name: " + q + r", short: " + q + r", region: '(\w+)'", src)]
    acc = json.loads((ROOT / 'data' / 'accuracy.json').read_text(encoding='utf-8'))
    SEED.parent.mkdir(exist_ok=True)
    SEED.write_text(json.dumps({'acc': acc, 'spots': spots, 'synced': acc['updated']}), encoding='utf-8')
    print('seed:', len(spots), 'spots, scores updated', acc['updated'])


def main():
    if git('status', '--porcelain', '--', *DATA).stdout.strip():
        sys.exit('data/ has uncommitted changes; leaving it alone')
    git('pull', '--rebase', '-q')
    run = subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'verify.py')], cwd=ROOT, text=True, capture_output=True)
    print(run.stdout[-3000:], run.stderr[-2000:])
    if run.returncode:
        sys.exit(f'verify.py failed ({run.returncode})')
    nsw = [l for l in (run.stdout + run.stderr).splitlines() if 'Byron Bay' in l or 'Sydney' in l]
    print('NSW buoy lines:', nsw or 'none (loaded fine)')
    git('add', *DATA)
    if git('diff', '--cached', '--quiet', check=False).returncode:
        git('commit', '-qm', 'Weekly NSW buoy fill and scores')
        for _ in range(3):
            if git('pull', '--rebase', '-q', check=False).returncode == 0 and git('push', '-q', check=False).returncode == 0:
                print('pushed')
                break
        else:
            sys.exit('push failed')
    else:
        print('no data change')
    seed()


if __name__ == '__main__':
    main()
