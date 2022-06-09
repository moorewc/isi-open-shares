const { workerData, parentPort } = require('worker_threads')
const IsilonClient = require('../lib/isilon');
const crypto = require('crypto');

const { config } = workerData;

const isilon = new IsilonClient({
    hostname: config.ssip,
    username: config.username,
    password: config.password
});

parentPort.on('message', async ({ cmd }) => {
    if (cmd === 'list_open_shares') {
        let zoneList = await isilon.GetAccessZones();
        let zones = [];

        let sessions = await isilon.GetUserSessions({});

        for (z of zoneList) {
            let pool = await isilon.GetAccessZonePool(z);

            let shareList = await isilon.GetShares({ zone: z });

            let zone = {
                name: z.id,
                pool: pool.sc_dns_zone,
                shares: shareList.map((s) => {
                    return {
                        path: s.path,
                        name: s.name,
                        openfiles: []
                    }
                })
            }

            for (share of zone.shares) {
                share.openfiles = await isilon.GetOpenFilesForShare({ path: share.path })
            }

            zones.push(zone);
        }

        open_shares = [];

        for (zone of zones) {
            for (share of zone.shares) {
                for (file of share.openfiles) {
                    unc_path = `\\\\${zone.pool}\\${share.name}`

                    for (s of sessions.filter((s) => { return s.user.includes(file.user) })) {
                        payload = {
                            zone: zone.name,
                            path: unc_path,
                            user: file.user,
                            computer: s.computer
                        }

                        const hash = crypto.createHash('md5')
                            .update(JSON.stringify(payload))
                            .digest("hex");

                        if (!open_shares.includes(hash)) {
                            open_shares.push(hash);
                            parentPort.postMessage({ hash, payload });
                        }
                    }
                }
            }
        }
    }
});