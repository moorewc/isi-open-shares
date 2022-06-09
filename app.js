const { Worker } = require('worker_threads')
const prompts = require('prompts')
const { ArgumentParser } = require('argparse');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const IsilonClient = require('./lib/isilon');
const { create } = require('domain');
const path = require('path');

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
    parser.add_argument('--interval', '-i', { required: false, help: 'Polling Interval in seconds', default: 60 })

    return parser.parse_args()
}

(async () => {
    const { hostname, interval } = GetArguments()
    const { username, password } = await GetCredentials()

    openfiles = {}

    const isilon = new IsilonClient({
        hostname: hostname,
        username: username,
        password: password
    });


    WorkerCallback = async ({ hash, payload }) => {
        if (!Object.keys(openfiles).includes(hash)) {
            openfiles[hash] = payload;
        }
    }

    CreateWorker = (config, id) => {
        const name = 'THREAD' + (id + 1).toString().padStart(3, '0');
        const worker = new Worker(`${__dirname}/lib/worker.js`, {
            workerData: { config, name, id }
        });

        worker.on('error', (err) => {
            throw err;
        });

        worker.on('message', WorkerCallback);

        return worker;
    };

    let zoneList = await isilon.GetAccessZones();
    let nodes = await isilon.GetNodes({ zone: zoneList.filter((z) => z.name === 'System')[0] });
    let workers = [];

    for (var i = 0; i < nodes.length; i++) {
        config = {
            ssip: nodes[i % nodes.length],
            username: username,
            password: password
        }

        workers.push(CreateWorker(config, i));
    }

    (loop = async () => {
        console.log(`Scanning for open shares on ${hostname}`);
        for (worker of workers) {
            worker.postMessage({ cmd: 'list_open_shares' });
        }

        const csvWriter = createCsvWriter({
            header: [
                { id: 'zone', title: 'Access Zone' },
                { id: 'path', title: 'UNC Path' },
                { id: 'user', title: 'User' },
                { id: 'computer', title: 'Computer' }
            ],
            path: 'openshares.csv'
        });

        await csvWriter.writeRecords(Object.keys(openfiles).map((k) => openfiles[k]));

        setTimeout(loop, 1000 * interval);
    })();
})();