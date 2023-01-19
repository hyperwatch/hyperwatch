## Monitor web traffic with syslog input from Apache

In this tutorial, we'll start analysing the web traffic on one or many Apache web servers using Hyperwatch.

We'll use the syslog protocol that is available to us through the powerful **[Piped Logs](https://httpd.apache.org/docs/2.4/logs.html#piped)** feature of Apache.

Let's start.

### Install Hyperwatch

On the same server where Apache is running, or on a server that is reachable by it, install the Hyperwatch processor.

As a prerequirement, you'll need Node.js &gt;= 7. Use nvm if you're in trouble.

```bash
nvm install node
```

#### Install from npm

```bash
npm install -g @hyperwatch/hyperwatch
```

#### Install from Git

Alternatively, for developemnt purpose, you can use Git and clone the public repository:

```bash
git clone https://github.com/hyperwatch/hyperwatch.git
cd hyperwatch
npm install
```

### Configure Hyperwatch

In our suggested configuration, Hyperwatch will be listening for access logs in the the `access_watch_combined` format on port `1518`.

We always recommand using the `access_watch_combined` format, which is logging more detailed information and allows for a much better analysis than the regular `combined` format.

To get more familiar, you can inspect default and example configurations in [`config/default.js`](<(../../config/default.js)>) and [`config/example.js`](../../config/example.js) file.

Now, you can create your own configuration in `apache_syslog_example.js`:

```javascript
module.exports = function (hyperwatch) {
  const { pipeline, input, format } = hyperwatch;

  hyperwatch.init();

  const syslogApacheHyperwatchCombinedInput = input.syslog.create({
    port: 1518,
    parse: format.apache.parser({
      format: format.apache.formats.hyperwatch_combined,
    }),
  });

  pipeline.registerInput(syslogApacheHyperwatchCombinedInput);
};
```

### Configure Apache

First, if you're following our recommendation and opted for the `hyperwatch_combined` format, you need to define it in the Apache configuration. This will not replace the standard log format, just create an additional one.

```
LogFormat "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-agent}i\" \"%{Accept}i\" \"%{Accept-Charset}i\" \"%{Accept-Encoding}i\" \"%{Accept-Language}i\" \"%{Connection}i\" \"%{Dnt}i\" \"%{From}i\" \"%{Host}i\"" hyperwatch_combined
```

Note that you're free to use whatever `LogFormat`, you just need to properly report it in the Hyperwatch configuration.

Second, you need to instruct Apache where to send the access logs. If it's not the same, you need to make sure that Apache can reach the server where Hyperwatch is running.

```
CustomLog "|/usr/bin/logger -n localhost -P 1518 --rfc3164" hyperwatch_combined
```

Note: This is known to be working on _Ubuntu 16.04, 18.04_ with _logger 2.27.1, 2.31.1_, let us know if you're in trouble and using something else.

In this example, there are 3 important things:

1. If Hyperwatch is running on the same server, we can use `localhost` as IP address.
   If it's on a different server, replace `localhost` by the proper private or public IP address.
2. We configured Hyperwatch to listen for syslog messages in the `hyperwatch_combined` format on port `1518`.
   We're properly passing that port in the configuration
3. Finally, we're asking Apache to use the `hyperwatch_combined` log format we previously configured.

Don't forget to reload Aapche with the updated configuration. On Ubuntu, it would be:

```bash
service apache2 reload
```

### Start Hyperwatch

Ok, now go back to where you wrote the config.

```bash
hyperwatch apache_syslog_example.js
```

### Browse the interface

Now, you can point your browser to the IP/port where Hyperwatch is running. If you see data flowing, congrats you made it!
