# WSL2 Networking Notes — k3s NodePort Access

## The problem

WSL2 normally auto-forwards `localhost` traffic from Windows into the WSL2 VM
for any service a process binds directly to (e.g. `npm start` on port 3000).

This does **not** work reliably for Kubernetes NodePort services. k3s/kube-proxy
expose NodePorts via iptables NAT rules rather than a literal bound socket, and
WSL2's localhost-relay mechanism does not detect or forward these kernel-level
NAT redirects. The result: `curl localhost:30080` succeeds *inside* WSL2, but
the same request from Windows (or a browser) gets `ERR_CONNECTION_REFUSED`.

## The fix

Connect to the WSL2 VM's actual internal IP instead of `localhost`:

    wsl hostname -I

This returns the current WSL2 VM IP, e.g. `172.20.142.140`.

Add a hosts file entry pointing your demo domain at that IP:

    172.20.142.140 biggshots.local

## The catch

The WSL2 VM IP **changes on every WSL2/laptop restart** (it's a dynamically
assigned address on a virtual switch). A static hosts entry breaks the next
time you restart.

## The solution

`scripts/windows/update-wsl-hosts.ps1` re-detects the current WSL2 IP and
rewrites the hosts entry automatically. Registered as a Windows Scheduled Task
(`UpdateWSLHosts`) that runs at logon with admin rights, with a retry loop
in case WSL2 hasn't finished booting yet.

## Migration note

This entire issue is WSL2-specific. On a dedicated Ubuntu Server (the planned
production target — see S15-S18), there is no host/VM IP distinction: the
server's own network interface IP is stable, so this workaround is not needed.
A real domain + DNS A-record + cert-manager replaces this local hosts-file
approach entirely.
