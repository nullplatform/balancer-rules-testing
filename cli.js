#!/usr/bin/env node

const { program } = require('commander');
const { TestServer } = require('./test-server/test-server');
const TestLibrary = require('./test-library/test-library');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

program
    .version('1.0.0')
    .option('-t, --tests <path>', 'Path to test file or directory', './tests')
    .option('--listen-ports <ports>', 'Comma-separated list of ports to listen on for mock servre', '80,443')
    .option('--server-ip <ip>', 'IP address for the test server', '127.0.0.1')
    .option('--dns-exclude <domains>', 'Comma-separated list of domains to exclude from DNS override', '')
    .option('--dns-default-server <ip>', 'Default DNS server IP', '8.8.8.8')
    .option('--dns-port <port>', 'DNS server port', '53')
    .option('--balancer-health-url <healthUrl>', 'Balancer health url',"http://localhost:8080/health")
    .option('--balancer-base-url <healthUrl>', 'Balancer health url',"http://localhost:8080")
    .option('--balancer-start-command <command>', 'Command to start the balancer')
    .parse(process.argv);

const options = program.opts();

// Parse options
const config = {
    server: {
        listenPorts: options.listenPorts.split(',').map(Number),
        serverIp: options.serverIp,
        dnsExclude: options.dnsExclude ? options.dnsExclude.split(',') : [],
        dnsDefaultServer: options.dnsDefaultServer,
        dnsPort: Number(options.dnsPort)
    },
    balancer: {
        healthUrl: options.balancerHealthUrl,
        startCommand: options.balancerStartCommand,
        baseUrl: options.balancerBaseUrl
    }
};

// Start TestServer
const server = new TestServer(config.server);
server.listen();

// Initialize TestLibrary
const testLib = new TestLibrary({
    baseUrl: `${config.balancer.baseUrl}`,
    serverCommand: options.balancerStartCommand,
    serverHealthUrl: options.balancerHealthUrl
});


async function runTests() {
    try {
        await testLib.startServer();

        const testsPath = path.resolve(process.cwd(), options.tests);
        const stats = fs.statSync(testsPath);

        if (stats.isDirectory()) {
            const testFiles = fs.readdirSync(testsPath).filter(file => file.endsWith('.test.js'));
            for (const file of testFiles) {
                await runTestFile(path.join(testsPath, file));
            }
        } else {
            await runTestFile(testsPath);
        }

        console.log('All tests completed successfully!');
    } catch (error) {
        console.error('Test run failed:', error);
    } finally {
        // Cleanup
        console.log('Cleaning up...');
        await testLib.stopServer();
        process.exit(0);
    }
}

async function runTestFile(filePath) {
    console.log(`Running tests in ${filePath}`);
    const testModule = require(filePath);
    if (typeof testModule === 'function') {
        await testModule(testLib);
    } else {
        console.error(`${filePath} does not export a function`);
    }
}

runTests().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});
