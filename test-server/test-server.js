const express = require('express');
const dns2 = require('dns2');
const { Packet } = dns2;
const fs = require("fs");
const net = require('net');
const https = require('https');

class CustomDNSResolver {

    constructor({ serverIp, dnsExclude=[], dnsDefaultServer="8.8.8.8", dnsPort=53, debug }) {
        this.dnsPort = dnsPort;
        this.debug = debug;
        this.serverIp = serverIp;
        this.dnsDefaultServer = dnsDefaultServer;
        this.server = dns2.createServer({
            udp: true,
            tcp:true,
            handle: async (request, send, rinfo) => {

                const response = Packet.createResponseFromRequest(request);
                const [ question ] = request.questions;
                const { name, type } = question;
                if (dnsExclude.indexOf(name) === -1) {
                    if (type === Packet.TYPE.A) {
                        // Handle A record (IPv4)
                        response.answers.push({
                            name,
                            type: Packet.TYPE.A,
                            class: Packet.CLASS.IN,
                            ttl: 300,
                            address: serverIp // Your server's IPv4 address
                        });
                    }
                    send(response);
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
            }
        });

        this.server.on('listening', () => {
            if(this.debug) {
                console.log("DNS Server listening on", this.server.addresses());
            }
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
    constructor({listenPorts=[80], listenSslPorts=[443], serverIp="127.0.0.1",dnsExclude=[], dnsDefaultServer="8.8.8.8", dnsPort=53, serviceHeader= 'x-kong-service-name', debug= false}) {
        this.app = express();
        this.listenPorts = listenPorts;
        this.listenSslPorts = listenSslPorts;
        this.listeners = [];
        this.debug = debug;
        this.httpsOptions = {
            key: fs.readFileSync('server.key'), // Path to your private key
            cert: fs.readFileSync('server.cert') // Path to your certificate
        };

        this.serverIp = serverIp;
        this.customResolver = new CustomDNSResolver({serverIp, dnsExclude, dnsDefaultServer, dnsPort, debug});
        this.app = express();
        this.app.use(express.json());
        this.app.all('*', (req, res) => {
            const serviceName = req.headers[serviceHeader.toLowerCase()];

            res.json({
                serviceCalled: serviceName,
                method: req.method,
                path: req.path,
                headers: {...req.headers,"test-server":"true"},
                body: req.body
            });
        });

    }
    async listen() {
        this.customResolver.listen();
        const serverIp = this.serverIp;
        this.listenPorts.forEach(port => {
            this.listeners.push(this.app.listen(port, serverIp));
        });

        this.listenSslPorts.forEach(port => {
            this.listeners.push(https.createServer(this.httpsOptions, this.app).listen(port, serverIp));
        })
        return new Promise(resolve => {
            setTimeout(resolve, 1000);
        })

    }

    shutdown() {
        this.customResolver.shutdown();
        this.listeners.forEach(listener => listener.close());

    }
}

module.exports = {CustomDNSResolver, TestServer};

