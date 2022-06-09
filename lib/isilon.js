const IsilonClient = require('@moorewc/node-isilon');

module.exports = class Client {
    constructor({ username, password, hostname }) {
        this.isilon = new IsilonClient({
            ssip: hostname,
            username: username,
            password: password
        });
    }

    GetShares = async ({ zone }) => {
        const url = `/platform/11/protocols/smb/shares?zone=${zone.id}`

        try {
            const response = await this.isilon.ssip.axios.get(url);

            return response.data.shares;
        } catch (error) {
            throw error;
        }
    }

    GetNodeIPs = async ({ pool }) => {
        const url = '/platform/11/network/interfaces'
        let response
        try {
            response = await this.isilon.ssip.axios.get(url)
        } catch (error) {
            throw error
        }

        const interfaces = response.data.interfaces

        // Danger Will Robinson, fancy filtering going on here.  Is this
        // efficient?  I don't know but it works!
        const nodes = interfaces
            .filter((i) => {
                // Remove any downed interfaces or interfaces with no IP assignments
                return i.ip_addrs.length > 0 && i.status === 'up'
            })
            .map((i) => {
                // Create a new object that has only lnn and ip_addrs field.  The
                // ip_addrs field is populated from the first ip address from the
                // owners which are members of groupnet/subnet/pool
                return {
                    lnn: i.lnn,
                    ip_addrs: i.owners
                        .filter((o) => {
                            return (
                                o.groupnet === pool.groupnet &&
                                o.pool === pool.name &&
                                o.ip_addrs.length > 0
                            )
                        })
                        .map((o) => o.ip_addrs[0]) // this
                }
            })
            .filter((i) => {
                // Remove any objects that have no ip_addrs
                return i.ip_addrs.length > 0
            })
            .map((i) => {
                // Create final object with lnn and ip field with single ip
                return {
                    lnn: i.lnn,
                    ip: i.ip_addrs[0]
                }
            })

        // It is possible that an lnn will have multiple ip assignments when
        // not using LACP.  Filter out additional ip assigments return only
        // one ip assigment per lnn.
        return [...new Map(nodes.map((item) => [item.lnn, item])).values()].map(
            (i) => {
                return i.ip
            }
        )
    }

    GetPool = async ({ groupnet, subnet, pool }) => {
        const url = `/platform/11/network/groupnets/${groupnet}/subnets/${subnet}/pools/${pool}`

        const response = await this.isilon.ssip.axios.get(url)

        return response.data.pools[0]
    }

    GetSubnet = async ({ groupnet, subnet }) => {
        const url = `/platform/11/network/groupnets/${groupnet}/subnets/${subnet}`

        const response = await this.isilon.ssip.axios.get(url)

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

        const response = await this.isilon.ssip.axios.get(url);

        let openfiles = response.data.openfiles.map((f) => {
            return {
                file: f.file.replaceAll('\\', '/').replace('C:', ''),
                user: f.user
            }
        }).filter((a) => {
            return a.file === path
        }).map((f) => {
            return {
                file: path,
                user: f.user
            }
        });

        return openfiles
    }

    GetUserSessions = async ({ resume = null }) => {
        let sessions = [];
        let url = `/platform/3/protocols/smb/sessions`;
        let response;

        try {
            let response = await this.isilon.ssip.axios.get(url);
            sessions = sessions.concat(response.data.sessions);

            if (response.data.resume) {
                sessions = sessions.concat(
                    await this.GetUserSessions({ resume: response.data.resume })
                )
            }
        } catch (error) {
            throw error;
        }

        return sessions;
    }

    GetAccessZonePool = async (zone) => {
        let subnets = []
        let pools = []
        const url = `/platform/11/network/groupnets/${zone.groupnet}`

        const response = await this.isilon.ssip.axios.get(url)
        const groupnet = response.data.groupnets[0]

        for (var _subnet of groupnet.subnets) {
            const subnet = await this.GetSubnet({
                groupnet: groupnet.name,
                subnet: _subnet
            })
            subnets = subnets.concat(_subnet)

            for (var _pool of subnet.pools) {
                const pool = await this.GetPool({
                    groupnet: groupnet.name,
                    subnet: _subnet,
                    pool: _pool
                })
                pools = pools.concat(pool)
            }
        }

        return pools.filter((pool) => {
            return pool.access_zone === zone.name
        })[0];
    }

    GetAccessZones = async () => {
        const response = await this.isilon.ssip.axios.get('/platform/11/zones');

        return response.data.zones
    }

    GetNodes = async ({ zone }) => {
        let pool = await this.GetAccessZonePool(zone);

        return await this.GetNodeIPs({ pool })
    }
}