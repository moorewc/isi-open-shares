const prompts = require('prompts')
const { ArgumentParser } = require('argparse');
const IsilonClient = require('@moorewc/node-isilon');

async function GetCredentials() {
    questions = [
        {
            type: 'text',
            name: 'username',
            message: 'Username:'
        },
        {
            type: 'password',
            name: 'password',
            message: 'Password:'
        }
    ]

    if (process.env.ISI_USERNAME && process.env.ISI_PASSWORD) {
        return {
            username: process.env.ISI_USERNAME,
            password: process.env.ISI_PASSWORD
        }
    }

    return await prompts(questions)
}

function GetArguments() {
    const parser = new ArgumentParser({
        description: 'Argparse example',
        add_help: true
    });

    parser.add_argument('--hostname', { required: true, help: 'IP Address or Hostname for System Access Zone.' })

    return parser.parse_args()
}

(async () => {
    const { hostname } = GetArguments()
    const { username, password } = await GetCredentials()

    const isilon = new IsilonClient({
        ssip: hostname,
        username: username,
        password: password
    });
    const axios = isilon.ssip.axios

    GetShares = async ({ zone }) => {
        const url = `/platform/11/protocols/smb/shares?zone=${zone.id}`

        try {
            const response = await axios.get(url);

            return response.data.shares;
        } catch (error) {
            throw error;
        }
    }

    GetPool = async ({ groupnet, subnet, pool }) => {
        const url = `/platform/11/network/groupnets/${groupnet}/subnets/${subnet}/pools/${pool}`

        const response = await axios.get(url)

        return response.data.pools[0]
    }

    GetSubnet = async ({ groupnet, subnet }) => {
        const url = `/platform/11/network/groupnets/${groupnet}/subnets/${subnet}`

        const response = await axios.get(url)

        return response.data.subnets[0]
    }

    uniqueOpenFiles = (data, key) => {
        return [
            ...new Map(
                data.map(x => [key(x), x])
            ).values()
        ]
    }

    GetOpenFilesForShare = async ({ path }) => {
        const url = `/platform/11/protocols/smb/openfiles`;

        const response = await axios.get(url);

        let openfiles = response.data.openfiles.map((f) => {
            return {
                file: f.file.replaceAll('\\', '/').replace('C:', ''),
                user: f.user
            }
        }).filter((a) => {
            return a.file.startsWith(path)
        }).map((f) => {
            return {
                file: path,
                user: f.user
            }
        });

        return openfiles
    }

    GetAccessZonePool = async (zone) => {
        let subnets = []
        let pools = []
        const url = `/platform/11/network/groupnets/${zone.groupnet}`

        const response = await axios.get(url)
        const groupnet = response.data.groupnets[0]

        for (_subnet of groupnet.subnets) {
            const subnet = await GetSubnet({
                groupnet: groupnet.name,
                subnet: _subnet
            })
            subnets = subnets.concat(_subnet)

            for (_pool of subnet.pools) {
                const pool = await GetPool({
                    groupnet: groupnet.name,
                    subnet: _subnet,
                    pool: _pool
                })
                pools = pools.concat(pool)
            }
        }

        return pools.filter((pool) => {
            return pool.access_zone === zone.name
        })
    }

    const GetAccessZones = async () => {
        const response = await axios.get('/platform/11/zones');

        return response.data.zones
    }

    let zoneList = await GetAccessZones();
    let zones = [];

    for (z of zoneList) {
        let poolList = await GetAccessZonePool(z);
        let shareList = await GetShares({ zone: z });

        let zone = {
            name: z.id,
            pools: poolList.map((p) => p.sc_dns_zone),
            shares: shareList.map((s) => {
                return {
                    path: s.path,
                    name: s.name,
                    openfiles: []
                }
            }).filter((s) => {
                return !s.name.endsWith('$')
            })
        }

        for (share of zone.shares) {
            share.openfiles = await GetOpenFilesForShare({ path: share.path })
        }

        zones.push(zone);
    }

    open_shares = {}

    for (zone of zones) {
        for (share of zone.shares) {
            for (file of share.openfiles) {
                unc_path = `\\\\${zone.pools[0]}\\${share.name}`

                if (!Object.keys(open_shares).includes(unc_path)) {
                    open_shares[unc_path] = []
                }

                if (!open_shares[unc_path].includes(file.user)) {
                    open_shares[unc_path].push(file.user)
                }
            }
        }
    }
    for (share of Object.keys(open_shares)) {
        console.log(share, open_shares[share].join(', '))
    }
})();