# Global Configuration

The constants configuration is done with the help of the [rc](https://www.npmjs.com/package/rc) node module.

Our recommended way to configure the constants is to add a `.hyperwatchrc` at the root of your project folder.

This file can be in either `JSON` (recommended) or `ini` format.

Here is an example of how this file can look like :

```JSON
{
  "port": 4000
}
```

This example would make the app be served on the 4000 port.

You can find below the list of all configurable constants:

## Global

| Constant name | Type    | Description                    |
| ------------- | ------- | ------------------------------ |
| port          | integer | The port the app is running on |
