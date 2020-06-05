const fs = require('fs');
const path = require('path');

const fetch = require('node-fetch'); // eslint-disable-line node/no-unpublished-require
const yaml = require('yamlparser'); // eslint-disable-line node/no-unpublished-require

fetch(
  'https://raw.githubusercontent.com/ua-parser/uap-core/master/regexes.yaml'
)
  .then((response) => response.text())

  .then((regexesYaml) => {
    fs.writeFileSync(
      path.resolve(__dirname, '..', 'src', 'data', 'regexes.yml'),
      regexesYaml
    );

    const regexesExtraYaml = fs
      .readFileSync(
        path.resolve(__dirname, '..', 'src', 'data', 'regexes-extra.yml')
      )
      .toString();

    const regexes = yaml.eval(regexesYaml);
    const regexesExtra = yaml.eval(regexesExtraYaml);

    fs.writeFileSync(
      path.resolve(__dirname, '..', 'src', 'data', 'regexes-robot.json'),
      JSON.stringify(regexesExtra.robot_parsers, null, 2)
    );

    const regexesAgent = regexesExtra.user_agent_parsers.concat(
      regexes.user_agent_parsers
    );
    fs.writeFileSync(
      path.resolve(__dirname, '..', 'src', 'data', 'regexes-agent.json'),
      JSON.stringify(regexesAgent, null, 2)
    );

    fs.writeFileSync(
      path.resolve(__dirname, '..', 'src', 'data', 'regexes-os.json'),
      JSON.stringify(regexes.os_parsers, null, 2)
    );

    fs.writeFileSync(
      path.resolve(__dirname, '..', 'src', 'data', 'regexes-device.json'),
      JSON.stringify(regexes.device_parsers, null, 2)
    );
  });
