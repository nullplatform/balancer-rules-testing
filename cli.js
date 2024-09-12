#!/usr/bin/env node

const { program } = require('commander');
const { TestServer } = require('./test-server/test-server');
const TestLibrary = require('./test-library/test-library');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const jest = require('jest');

program
    .version('1.0.0')
    .option('-t, --tests <path>', 'Path to test file or directory')
    .option('--listen-ports <ports>', 'Comma-separated list of ports to listen on for mock server', '80')
    .option('--listen-ssl-ports <ports>', 'Comma-separated list of ports to listen on for mock server in ssl', '443')
    .option('--server-ip <ip>', 'IP address for the test server', '127.0.0.1')
    .option('--dns-exclude <domains>', 'Comma-separated list of domains to exclude from DNS override', '')
    .option('--dns-default-server <ip>', 'Default DNS server IP', '8.8.8.8')
    .option('--dns-port <port>', 'DNS server port', '53')
    .option('--balancer-health-url <healthUrl>', 'Balancer health url',"http://127.0.0.1:8080/health")
    .option('--balancer-base-url <healthUrl>', 'Balancer health url',"http://127.0.0.1:8080")
    .option('--balancer-start-command <command>', 'Command to start the balancer')
    .option('--service-header <headerName>', 'Service header to be returned in the response', 'x-kong-service-name')
    .parse(process.argv);

const options = program.opts();
let config;
let server;
let testLib;
// Parse options
try {
    config = {
        server: {
            listenPorts: options.listenPorts.split(',').map(Number),
            listenSslPorts: options.listenSslPorts.split(',').map(Number),
            serverIp: options.serverIp,
            dnsExclude: options.dnsExclude ? options.dnsExclude.split(',') : [],
            dnsDefaultServer: options.dnsDefaultServer,
            dnsPort: Number(options.dnsPort),
            serviceHeader: options.serviceHeader
        },
        balancer: {
            healthUrl: options.balancerHealthUrl,
            startCommand: options.balancerStartCommand,
            baseUrl: options.balancerBaseUrl
        },
        tests: {
            path: options.tests
        }
    };
    if(!config.tests.path) {
        throw new Error('Test path is required');
    }
    // Start TestServer
    server = new TestServer(config.server);


// Initialize TestLibrary
    testLib = new TestLibrary({
        baseUrl: `${config.balancer.baseUrl}`,
        serverCommand: config.balancer.startCommand,
        serverHealthUrl: config.balancer.healthUrl
    });

}catch (e) {
    console.error('Error parsing options:', e);
    console.log(program.help());
    process.exit(1);
}

async function cleanUp() {
    if (server) {
        server.shutdown();
    }
    if (testLib) {
        await testLib.stopServer();
    }
}

process.on('SIGINT', async () => {
    console.log('Caught interrupt signal (SIGINT), cleaning up...');
    // Call your function here
    await cleanUp();

    process.exit();
});

process.on('SIGTERM', async () => {
    console.log('Caught termination signal (SIGTERM), cleaning up...');
    // Call your function here
    await cleanUp();

    process.exit();
});

async function runTests() {
    try {
        await testLib.startServer();

        const testsPath = path.resolve(process.cwd(), config.tests.path);
        global.__TEST_LIBRARY__ = testLib;
        const jestConfig = {
            rootDir: process.cwd(),
            testMatch: [path.resolve(process.cwd(), testsPath, '**/*.test.js')],
        };
        const result = await jest.runCLI(jestConfig, [process.cwd()]);
        if (!result.results.success) {
            throw new Error('Tests failed');
        }

        console.log('All tests completed successfully!');
    } catch (error) {
        console.error('Test run failed:', error);
    } finally {
        // Cleanup
        console.log('Cleaning up...');
        await cleanUp();
        process.exit(0);
    }
}

async function startServer() {
    await server.listen();
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

startServer().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
}).finally(() => {
    runTests().catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
    });
})


