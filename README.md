# Balancer Rules Test

## Example

You should have installed nginx

`node cli.js --listen-ports 9090 --dns-port 5445 --balancer-start-command "/opt/homebrew/bin/nginx -g 'daemon off;' -c /Users/geisbruch/workspace/null/balancer-rules-testing/samples/nginx.conf" -t samples/ --service-header X-Service --listen-ssl-ports 8443`
