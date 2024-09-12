const express = require('express');
const dns2 = require('dns2');
const { Packet } = dns2;

const net = require('net');

class CustomDNSResolver {

    constructor({ serverIp, dnsExclude=[], dnsDefaultServer="8.8.8.8", dnsPort=53 }) {
        this.dnsPort = dnsPort;
        this.serverIp = serverIp;
        this.dnsDefaultServer = dnsDefaultServer;
        this.server = dns2.createServer({
            udp: true,
            handle: (request, send, rinfo) => {
                const response = Packet.createResponseFromRequest(request);
                const [ question ] = request.questions;
                const { name } = question;

                console.log(`DNS Query for ${name}`);

                // Add your domain overrides here
                const dnsOverrides = {
                    'example.com': '172.20.0.20',
                    // Add more overrides as needed
                };

                if (dnsExclude.indexOf(name) === -1) {
                    response.answers.push({
                        name,
                        type: Packet.TYPE.A,
                        class: Packet.CLASS.IN,
                        ttl: 300,
                        address: serverIp
                    });
                } else {
                    // For non-overridden domains, forward the request to the system's DNS
                    const systemDns = new dns2({
                        nameServers: [dnsDefaultServer] // You can change this to your preferred DNS server
                    });

                    systemDns.resolve(name, (err, result) => {
                        if (err) {
                            console.error(`Error resolving ${name}:`, err);
                            send(response);
                        } else {
                            response.answers = result.answers;
                            send(response);
                        }
                    });
                    return;
                }

                send(response);
            }
        });

        this.server.on('listening', () => {
            console.log(this.server.addresses());
        });

        this.server.on('close', () => {
            console.log('server closed');
        });
    }

    listen() {
        this.server.listen({
            // Optionally specify port, address and/or the family of socket() for udp server:
            udp: {
                port: this.dnsPort,
                address: this.serverIp,
                type: "udp4",  // IPv4 or IPv6 (Must be either "udp4" or "udp6")
            },

            // Optionally specify port and/or address for tcp server:
            tcp: {
                port: this.dnsPort,
                address: this.serverIp,
            },
        });
    }

    shutdown() {
        this.server.close();
    }
}

class TestServer {
    constructor({listenPorts=[80,443], serverIp="127.0.0.1",dnsExclude=[], dnsDefaultServer="8.8.8.8", dnsPort=53}) {
        this.app = express();
        this.listenPorts = listenPorts;
        this.serverIp = serverIp;
        this.customResolver = new CustomDNSResolver({serverIp, dnsExclude, dnsDefaultServer, dnsPort});
        this.app = express();
        this.app.use(express.json());
        this.app.all('*', (req, res) => {
            const serviceName = req.headers['x-kong-service-name'];
            res.json({
                serviceCalled: serviceName,
                method: req.method,
                path: req.path,
                headers: req.headers,
                body: req.body
            });
        });

    }
    listen() {
        this.customResolver.listen();
        const serverIp = this.serverIp;
        this.listenPorts.forEach(port => {
            this.app.listen(port, serverIp);
        });
    }

    shutdown() {
        this.customResolver.shutdown();
        this.app.close();
    }
}

module.exports = {CustomDNSResolver, TestServer};

const server = new TestServer({listenPorts:[8080,8443], dnsPort:5333});
server.listen();
