# HDN - My Own CDN

HDN stands for Handaru Delivery Network is basically a CDN built around and for what my projects needs. HDN built utilizing the GitHub raw file feature to minimize cost spend on hosting provider.

# Feature Planning
[] Set cdn.handaru.dev as domain pointer to this CDN.

# How to Use
Just import each icons or fonts manually by using the GitHub user raw content URLs.

It's recommended to use variable for the domain address instead of hardcoded all domain into cdn.handaru.dev since if domain change happen it gonna take a long time to change entire codebase with the new domain.

```
// Set variable to current HDN domain
$DOMAIN = cdn.handaru.dev

// Use it with calling that variable
icon = $DOMAIN/bedrock-perfected/bedrock-perfected-logo.svg
```

## GitHub RAW URL
```
raw.githubusercontent.com/daniswastaken/hdn/main/{project}/{files.xyz}
```