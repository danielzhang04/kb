"""Hand a broker child a PIPE on stdin and a real controlling terminal on stdout/stderr, then exec it.

Three things can only be done between fork and exec, inside the child itself, which is why this file
exists rather than being three more lines of `spawnBrokerChild`:

  1. DROP THE PTY MASTER. node-pty's openpty sets FD_CLOEXEC on neither end of the pair, and libuv
     closes nothing beyond the stdio slots, so without this the agent - and every grandchild it
     spawns - inherits the master at its raw number. That is a read of its own transcript before the
     broker ever sees it, and a write the slave echoes straight back as if the child had printed it.
     Closing every descriptor we were not handed deliberately is the only bound that does not depend
     on knowing which number leaked.
  2. UNSET O_NONBLOCK on the terminal. node-pty opens the slave non-blocking, and dup2 shares the open
     file description, so fd 1 and fd 2 would inherit it and any burst larger than the pty buffer
     would come back EAGAIN - `write error: Resource temporarily unavailable` from bash, WouldBlock
     from a Rust CLI, a silent short write from Node. Re-opening the terminal BY NAME makes a fresh
     open file description, which is blocking by default.
  3. ACQUIRE A CONTROLLING TERMINAL (TIOCSCTTY). setsid alone leaves the session with none, so
     SIGWINCH on resize reaches nobody and /dev/tty cannot be opened. TIOCSCTTY must be issued by the
     session leader itself, which no parent can do on its behalf.

Invoked as: python3 <this file> <keep-fds> <argv0> [args...]
<keep-fds> is a comma-separated descriptor list whose FIRST entry is the one to exec. Those
descriptors reached us through stdio slots (dup2 clears FD_CLOEXEC, which is what lets them survive
our own exec into python). Nothing here reads a path the dashboard chose: the CLI is a descriptor,
not a name, so the fd pin the broker's walk established is exactly what runs.
"""

import errno
import fcntl
import os
import sys
import termios


def main(argv):
    if len(argv) < 2:
        sys.stderr.write('pipe-stdin-exec: usage: <keep-fds> <argv0> [args...]\n')
        return 2
    try:
        return exec_child(argv)
    except OSError as failure:
        # fd 2 IS the session transcript and the broker records it byte for byte, so a Python
        # traceback here would be sprayed into the operator's terminal and into the persisted
        # transcript. One bounded line naming the errno says the same thing and stays parseable.
        sys.stderr.write('pipe-stdin-exec: %s\n' % errno.errorcode.get(failure.errno, 'EUNKNOWN'))
        return 1


def exec_child(argv):
    keep_fds = [int(value) for value in argv[0].split(',')]
    exec_fd = keep_fds[0]
    # A fresh open file description on the same terminal: blocking, and ours to make controlling.
    terminal = os.open(os.ttyname(1), os.O_RDWR | os.O_NOCTTY)
    # The broker spawns us detached, so libuv has already called setsid and we lead this session.
    # Guarded rather than assumed: setsid on a leader fails EPERM, and a non-leader cannot TIOCSCTTY.
    if os.getpid() != os.getsid(0):
        os.setsid()
    # 0 = do not steal the terminal away from another session; refuse instead.
    fcntl.ioctl(terminal, termios.TIOCSCTTY, 0)
    os.dup2(terminal, 1)
    os.dup2(terminal, 2)
    if terminal > 2:
        os.close(terminal)
    # Everything else goes, whatever it was and whoever leaked it - the pty master and node-pty's own
    # slave copy included. The listing is taken first, so closing its own descriptor is safe.
    keep = frozenset([0, 1, 2] + keep_fds)
    for name in os.listdir('/proc/self/fd'):
        try:
            fd = int(name)
        except ValueError:
            continue
        if fd in keep:
            continue
        try:
            os.close(fd)
        except OSError:
            pass
    # FD_CLOEXEC rather than inheritable. execve resolves /proc/self/fd/<n> BEFORE the close-on-exec
    # sweep, so the CLI still starts from the pinned inode - and then begins life holding 0, 1 and 2
    # and nothing else, not even the descriptor it was execed from.
    os.set_inheritable(exec_fd, False)
    os.execv('/proc/self/fd/%d' % exec_fd, list(argv[1:]))


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
