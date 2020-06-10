const stylesheet = `body {
  color: #eeeeee;
  background: #2e2e2e;
  font-size: 12px;
  font-family: SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace;
  white-space: pre-wrap;
}

table { border-collapse: collapse; }
th, td { border:1px solid #494949; padding: 3px 7px; }
th { color: #797979; font-weight: bold; }
table tr:first-child th, table tr:first-child td { border-top: 0; }
table tr th:first-child, table tr td:first-child { border-left: 0; }
table tr:last-child th, table tr:last-child td { border-bottom: 0; }
table tr th:last-child, table tr td:last-child { border-right: 0; }

a { color: inherit }

.red { color: #ff5086; }
.cyan { color: #4cdeea; }
.grey { color: #797979; }
.yellow { color: #ffd74b; }
.orange { color: #ff8b57; }
.green { color: #99de66; }
.magenta { color: #ab98f4; }`;

module.exports = stylesheet;
