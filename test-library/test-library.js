const axios = require('axios');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const {exec, spawn } = require('node:child_process');
const shlex = require('shlex'); // Use shlex to handle quoted arguments
const treeKill = require('tree-kill');


class TestLibrary {
    constructor({baseUrl = 'http://localhost:8080', serverCommand, serverHealthUrl, debug=false, serverStopCommand}) {
        this.baseUrl = baseUrl;
        if(!serverCommand) {
            throw new Error("server command should be defined");
        }
        this.serverStopCommand = serverStopCommand;
        this.debug = debug;
        this.serverCommand = shlex.split(serverCommand); // Handle command with quoted arguments
        this.serverHealthUrl = serverHealthUrl;
        this.serverProcess = null; // To store the child process instance
        this.jwtSecret = crypto.randomBytes(32).toString('hex'); // Generate a random secret for signing JWTs
    }

    async testRequest({
                          method = 'GET',
                          path = '/',
                          headers = {},
                          body = null,
                          expectedService = null,
                          expectedStatus = 200,
                          assertion = null,
                          timeout = 5000,
                          expectedHeaders= null
                      }) {
        try {
            const response = await axios({
                method,
                url: `${this.baseUrl}${path}`,
                headers,
                data: body,
                timeout,
                validateStatus: () => true // This allows us to handle all status codes
            });

            if(this.debug) {
                console.log("Response data: ");
                console.log(response.data)
            }
            // Assert status code
            assert.strictEqual(response.status, expectedStatus, `Expected status ${expectedStatus}, but got ${response.status}`);

            // Assert service
            if (expectedService) {
                assert.strictEqual(response.data.serviceCalled, expectedService, `Expected service ${expectedService}, but got ${response.data.serviceCalled}`);
            }

            if(expectedHeaders) {
                for (const [key, value] of Object.entries(expectedHeaders)) {
                    assert.strictEqual(response.data.headers[key], value, `Expected header ${key} to be ${value}, but got ${response.data.headers[key]}`);
                }
            }

            // Run custom assertion if provided
            if (assertion && typeof assertion === 'function') {
                await assertion(response.data, response);
            }

            return response.data;
        } catch (error) {
            console.error('Test request failed:', error.message);
            throw error;
        }
    }

    getToken({ roles = [], userId = 'test-user', username = 'test-username', email = 'test@example.com', expiresIn = '1h' }) {
        const payload = {
            jti: crypto.randomUUID(),
            exp: Math.floor(Date.now() / 1000) + (60 * 60), // 1 hour from now
            iat: Math.floor(Date.now() / 1000),
            iss: 'https://test-issuer.com',
            aud: 'test-client',
            sub: userId,
            typ: 'Bearer',
            azp: 'test-client',
            session_state: crypto.randomBytes(32).toString('hex'),
            acr: '1',
            'allowed-origins': ['*'],
            realm_access: { roles: roles },
            resource_access: {
                'test-client': {
                    roles: roles
                }
            },
            scope: 'openid profile email',
            sid: crypto.randomBytes(32).toString('hex'),
            email_verified: true,
            name: `${username} Test`,
            preferred_username: username,
            given_name: username,
            family_name: 'Test',
            email: email
        };

        return jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });
    }

    async startServer() {
        return new Promise((resolve, reject) => {
            if (this.serverProcess) {
                return reject(new Error('Server is already running'));
            }

            const [command, ...args] = this.serverCommand;
            this.serverProcess = spawn(command, args, {shell: true, stdio:"inherit", detached: false});

            this.serverProcess.on('error', (err) => {
                console.error('Failed to start server:', err);
                reject(err);
            });

            this.serverProcess.on('exit', (code, signal) => {
                this.serverProcess = null;
            });

            // Wait for server to be healthy
            this.waitForServer()
                .then(resolve)
                .catch(async (err) => {
                    console.error('Server failed to start:', err);
                    await this.stopServer(); // Stop the server if health check fails
                    reject(err);
                });
        });
    }

    async stopServer() {
        const killProcess = (pid) => {
            return new Promise((resolveKill) => {
                treeKill(pid, 'SIGTERM', (err) => {
                    if (err) {
                        console.error(`Failed to kill process ${pid}:`, err);
                    } else {
                        console.log(`Successfully killed process ${pid}`);
                    }
                    resolveKill();
                });
            });
        };
        return new Promise((resolve, reject) => {
            if (!this.serverProcess) {
                return reject(new Error('No server process running'));
            }

            this.serverProcess.on('close', (code) => {
                this.serverProcess = null;

            });


            if (this.serverStopCommand) {
                // Execute the stop command
                new Promise(() => {
                    exec(this.serverStopCommand, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Error stopping server: ${error}`);
                            reject(error);
                        } else {
                            console.log('Server stopped successfully');
                            resolve();
                        }
                    });
                });
            } else {
                killProcess(this.serverProcess.pid);
                resolve();
            }
        });
    }

    async waitForServer(maxAttempts = 120, interval = 1000) {
        let attempts = 0;

        const checkHealth = async () => {
            try {
                const response = await axios.get(this.serverHealthUrl, { timeout: 1000 });
                if (response.status === 200) {
                    console.log('Server is healthy');
                    return true;
                }
            } catch (error) {
                console.log(`Server health check attempt ${attempts + 1} failed`);
            }

            return false;
        };

        while (attempts < maxAttempts) {
            const healthy = await checkHealth();
            if (healthy) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, interval));
            attempts++;
        }

        throw new Error('Server health check failed after maximum attempts');
    }


    // New method to verify a token
    verifyToken(token) {
        try {
            return jwt.verify(token, this.jwtSecret);
        } catch (error) {
            console.error('Token verification failed:', error.message);
            return null;
        }
    }

}

module.exports = TestLibrary;
