// The command line of a check: `--name value` options and bare `--switch`es.
//
// A check that ignores what it does not understand is worse than one that refuses
// it. `--dirs build` run as `--dir build` would scan the default targets, pass, and
// leave its author thinking the directory had been looked at; `--dir` with its value
// forgotten would scan the working directory. Both are errors here.

/**
 * Reads `argv` against the options (each takes the next argument) and the switches
 * (each stands alone) a check knows. Returns `{ values, switches }`, where `values`
 * maps each option to the list of values it was given, and throws an `Error` that
 * says what is wrong with the command line otherwise.
 *
 * @param {string[]} argv
 * @param {{ options?: string[], switches?: string[] }} known
 */
export function readArguments(argv, { options = [], switches = [] } = {}) {
  const values = Object.fromEntries(options.map((name) => [name, []]));
  const on = new Set();
  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at];
    if (options.includes(argument)) {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} takes a value.`);
      }
      values[argument].push(value);
      at += 1;
    } else if (switches.includes(argument)) {
      on.add(argument);
    } else {
      const known = [...options, ...switches];
      throw new Error(
        `Unknown argument ${JSON.stringify(argument)}.${known.length > 0 ? ` This check takes ${known.join(", ")}.` : " This check takes no argument."}`,
      );
    }
  }
  return { values, switches: on };
}
