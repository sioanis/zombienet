import { decorators } from "./colors";
import {
  DEFAULT_COMMAND,
  P2P_PORT,
  RPC_HTTP_PORT,
  RPC_WS_PORT,
} from "./configManager";
import { Node } from "./types";
import { getRandomPort } from "./utils";

function parseCmdWithArguments(commandWithArgs: string, useWrapper = true): string[] {
  const parts = commandWithArgs.split(" ");
  let finalCommand: string[] = [];
  if (["bash", "ash"].includes(parts[0])) {
    finalCommand.push(parts[0]);
    let partIndex;
    if (parts[1] === "-c") {
      finalCommand.push(parts[1]);
      partIndex = 2;
    } else {
      finalCommand.push("-c");
      partIndex = 1;
    }
    finalCommand = [...finalCommand, ...[parts.slice(partIndex).join(" ")]];
  } else {
    finalCommand = [commandWithArgs];
    if(useWrapper) finalCommand.unshift("/cfg/zombie-wrapper.sh");
  }

  return finalCommand;
}

export async function genCollatorCmd(
  command: string,
  nodeSetup: Node,
  cfgPath: string = "/cfg",
  useWrapper = true
): Promise<string[]> {
  const { name, args, chain, bootnodes } = nodeSetup;
  const parachainAddedArgs: any = {
    "--name": true,
    "--collator": true,
    "--force-authoring": true,
  };

  let fullCmd: string[] = [
    command,
    "--name",
    name,
    "--collator",
    "--force-authoring",
  ];

  if (nodeSetup.args.length > 0) {
    let argsCollator = null;
    let argsParachain = null;
    let splitIndex = args ? args.findIndex((value) => value == "--") : -1;

    if (splitIndex < 0) {
      argsParachain = args;
    } else {
      argsParachain = args ? args.slice(0, splitIndex) : null;
      argsCollator = args ? args.slice(splitIndex + 1) : null;
    }

    if (argsParachain) {
      for (const arg of argsParachain) {
        if (parachainAddedArgs[arg]) continue;

        // add
        console.log(`adding ${arg}`);
        fullCmd.push(arg);
      }
    }

    // Arguments for the relay chain node part of the collator binary.
    fullCmd.push(...["--", "--chain", `${cfgPath}/${chain}.json`]);

    const collatorPorts: any = {
      "--port": 0,
      "ws-port": 0,
      "rpc-port": 0,
    };

    if (argsCollator) {
      // Add any additional flags to the CLI
      for (const [index, arg] of argsCollator.entries()) {
        if (collatorPorts[arg] >= 0) {
          // port passed as argument, we need to ensure is not a default one because it will be
          // use by the parachain part.
          const selectedPort = parseInt(argsCollator[index + 1], 10);
          if ([P2P_PORT, RPC_HTTP_PORT, RPC_WS_PORT].includes(selectedPort)) {
            console.log(
              decorators.yellow(
                `WARN: default port configured, changing to use a random free port`
              )
            );
            const randomPort = await getRandomPort();
            collatorPorts[arg] = randomPort;
            argsCollator[index + 1] = randomPort.toString();
          }
        }
      }

      // check ports
      for (const portArg of Object.keys(collatorPorts)) {
        if (collatorPorts[portArg] === 0) {
          const randomPort = await getRandomPort();
          argsCollator.push(portArg);
          argsCollator.push(randomPort.toString());
          console.log(`Added ${portArg} with value ${randomPort}`);
        }
      }

      fullCmd = fullCmd.concat(argsCollator);
      console.log(`Added ${argsCollator} to collator`);
    }
  }

  if(useWrapper) fullCmd.unshift("/cfg/zombie-wrapper.sh");
  return fullCmd;
}

export async function genCmd(nodeSetup: Node, cfgPath: string = "/cfg", useWrapper = true, portFlags?: { [flag: string]: number } ): Promise<string[]> {
  let {
    name,
    chain,
    commandWithArgs,
    fullCommand,
    command,
    telemetry,
    telemetryUrl,
    prometheus,
    validator,
    bootnodes,
    args,
    zombieRole,
  } = nodeSetup;

  // fullCommand is NOT decorated by the `zombie` wrapper
  // and is used internally in init containers.
  if (fullCommand) return ["bash", "-c", fullCommand];

  // command with args
  if (commandWithArgs) {
    return parseCmdWithArguments(commandWithArgs);
  }

  if (!command) command = DEFAULT_COMMAND;

  // IFF the node is a cumulus based collator
  if (zombieRole === "collator" && !command.includes("adder")) {
    return await genCollatorCmd(command, nodeSetup);
  }

  args.push("--no-mdns");

  if (!telemetry) args.push("--no-telemetry");
  else args.push("--telemetry-url", telemetryUrl);

  if (prometheus) args.push("--prometheus-external");

  if (validator) args.push("--validator");

  if (bootnodes && bootnodes.length)
    args.push("--bootnodes", bootnodes.join(","));


  if(portFlags) {
    // ensure port are set as desired
    for(const flag of Object.keys(portFlags)) {
      const index = args.findIndex( arg => arg === flag);
      if(index < 0) args.push(...[flag, portFlags[flag].toString()]);
      else {
        args[index+1] = portFlags[flag].toString()
      }
    }

    // special case for bootnode
    // use `--listen-addr` to bind 0.0.0.0 and don't use `--port`.
    // --listen-addr /ip4/0.0.0.0/tcp/30333
    if(zombieRole === "bootnode") {
      const port = portFlags["--port"];
      const listenIndex = args.findIndex(arg => arg === "--listen-addr")
      if(listenIndex >= 0) {
        const parts = args[listenIndex+1].split("/");
        parts[4] = port.toString();
        args[listenIndex+1] = parts.join("/");
      } else {
        args.push(...["--listen-addr", `/ip4/0.0.0.0/tcp/${port}`])
      }

      const portFlagIndex = args.findIndex(arg => arg === "--port");
      if(portFlagIndex >= 0) args.splice(portFlagIndex, 2);
    }
  }

  const finalArgs: string[] = [
    command,
    "--chain",
    `${cfgPath}/${chain}.json`,
    "--name",
    name,
    "--rpc-cors",
    "all",
    "--unsafe-rpc-external",
    "--rpc-methods",
    "unsafe",
    "--unsafe-ws-external",
    "--tmp",
    ...args,
  ];

  const resolvedCmd = [finalArgs.join(" ")];
  if(useWrapper) resolvedCmd.unshift("/cfg/zombie-wrapper.sh");
  return resolvedCmd;
}
