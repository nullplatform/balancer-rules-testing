#!/usr/bin/env node

const { program } = require('commander');
const { TestServer } = require('./test-server/test-server');
const TestLibrary = require('./test-library/test-library');
const path = require('path');
const fs = require('fs');
const { exec,spawn } = require('child_process');
const jest = require('jest');

program
    .version('1.0.0')
    .option('-t, --tests <path>', 'Path to test file or directory, you can use multiple folders split by comma')
    .option('--listen-ports <ports>', 'Comma-separated list of ports to listen on for mock server', '80')
    .option('--listen-ssl-ports <ports>', 'Comma-separated list of ports to listen on for mock server in ssl', '443')
    .option('--server-ip <ip>', 'IP address for the test server', '127.0.0.1')
    .option('--dns-exclude <domains>', 'Comma-separated list of domains to exclude from DNS override', '')
    .option('--dns-default-server <ip>', 'Default DNS server IP', '8.8.8.8')
    .option('--dns-port <port>', 'DNS server port', '53')
    .option('--balancer-health-url <healthUrl>', 'Balancer health url',"http://127.0.0.1:8080/health")
    .option('--balancer-base-url <healthUrl>', 'Balancer health url',"http://127.0.0.1:8080")
    .option('--balancer-start-command <command>', 'Command to start the balancer')
    .option('--balancer-stop-command <command>', 'Command to stop the balancer')

    .option('--service-header <headerName>', 'Service header to be returned in the response', 'x-kong-service-name')
    .option('--debug <true/false>', 'Sets debug to true', "false")
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
            baseUrl: options.balancerBaseUrl,
            stopCommand: options.balancerStopCommand,
        },
        tests: {
            path: options.tests
        },
        debug: options?.debug === "true"
    };
    if(!config.tests.path) {
        throw new Error('Test path is required');
    }
    // Initialize TestServer
    server = new TestServer({...config.server, debug: config.debug});

    // Initialize TestLibrary
    testLib = new TestLibrary({
        baseUrl: `${config.balancer.baseUrl}`,
        serverCommand: config.balancer.startCommand,
        serverStopCommand: config.balancer.stopCommand,
        serverHealthUrl: config.balancer.healthUrl,
        debug: config.debug
    });

}catch (e) {
    console.error('Error parsing options:', e);
    console.log(program.help());
    process.exit(1);
}

async function cleanUp() {
    if (server) {
        console.log("Stopping mock server");
        await server.shutdown();
    }
    if (testLib) {
        console.log("Stopping server");
        await testLib.stopServer();
    }
}

process.on('SIGINT', async () => {
    console.log('Caught interrupt signal (SIGINT), cleaning up...');
    await cleanUp();
    process.exit(1);
});

process.on('SIGTERM', async () => {
    console.log('Caught termination signal (SIGTERM), cleaning up...');
    await cleanUp();
    process.exit(1);
});

async function runTests() {
    let exitCode = 0;
    try {
        // Start the server and testLib before running tests
        await server.listen();
        await testLib.startServer();

        const testFolders = config.tests.path.split(",").map(folder => folder.trim());
        const resolvedTestPaths = testFolders.map(folder => {
            // Check if the folder is already an absolute path
            if (path.isAbsolute(folder)) {
                return path.join(folder, '**/*.test.js');
            } else {
                return path.resolve(process.cwd(), folder, '**/*.test.js');
            }
        });

        global.__TEST_LIBRARY__ = testLib;

        // Configure Jest
        const jestConfig = {
            roots: testFolders, // Set the roots to the test folders
            testMatch: ['**/*.test.js'], // Match test files in each folder
            setupFilesAfterEnv: [path.resolve(__dirname, 'jest.setup.js')], // Add setup file
            runInBand: true, // Run tests serially in the current process
            testEnvironment: 'node', // Ensure tests run in Node environment
        };

        if(config.debug) {
            console.log(jestConfig);
        }

        const result = await jest.runCLI(jestConfig, [process.cwd()]);
        if (!result.results.success) {
            throw new Error('Tests failed');
        }

        console.log('All tests completed successfully!');
    } catch (error) {
        console.error('Test run failed:', error);
        exitCode = 1;
    } finally {
        // Cleanup
        console.log('Cleaning up...');
        await cleanUp();
        process.exit(exitCode);
    }
}

// Create jest.setup.js file if it doesn't exist
const setupContent = `
// This file ensures that the global __TEST_LIBRARY__ is available in all tests
beforeAll(() => {
    if (!global.__TEST_LIBRARY__) {
        throw new Error("__TEST_LIBRARY__ is not defined. Make sure it is set before running tests.");
    }
});
`;

const setupFilePath = path.resolve(__dirname, 'jest.setup.js');
if (!fs.existsSync(setupFilePath)) {
    fs.writeFileSync(setupFilePath, setupContent);
    console.log('Created jest.setup.js file');
}

// Main execution
async function main() {
    try {
        await runTests();
    } catch (error) {
        console.error('Unexpected error:', error);
        process.exit(1);
    }
}

main();
