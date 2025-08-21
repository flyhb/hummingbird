import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { AddressLike, Contract, ethers } from "ethers";

/*
 * Custom Hardhat tasks for interacting with the Hummingbird delivery
 * functionality.  These helpers wrap the various delivery-related methods
 * exposed by the Hummingbird contract and provide a friendly CLI for
 * common workflows such as creating requests, proposing deliveries as a
 * drone, accepting proposals as a requester, and progressing through
 * the start→picked→dropped→complete lifecycle.  In addition to the
 * core create/cancel/open-target tasks requested by the user, a number
 * of convenience tasks are included to aid development and testing.
 */

// -------------------------------------------------------------------------
// Helpers
//
// A handful of small utility functions to parse user input into the
// appropriate on‑chain formats, look up the deployed contract instance
// from either the environment or explicit flags, and produce human
//‑readable status names from the contract's `Status` enum.  These
// functions are deliberately defined outside of the task definitions so
// they can be reused throughout this file.

const ZERO = "0x0000000000000000000000000000000000000000";

// Mirror of the Status enum defined in Hummingbird.sol.  When
// decoding request structs we translate the numeric status into one of
// these strings for display.  Unknown numeric values fall back to
// `Unknown(<code>)`.
const STATUS = [
  "Open",       // 0
  "Proposed",   // 1
  "Accepted",   // 2
  "Started",    // 3
  "PickedUp",   // 4
  "Dropped",    // 5
  "Completed",  // 6
  "Cancelled",  // 7
] as const;

function statusName(code: number | bigint): string {
  const i = Number(code);
  return STATUS[i] ?? `Unknown(${i})`;
}

/**
 * Parse a comma‑separated latitude,longitude pair (degrees) into the
 * integer E7 format required by the Hummingbird contract.  Throws an
 * error if the input is malformed or out of range.
 */
function parseLatLon(input: string): { latE7: number; lonE7: number } {
  const [latStr, lonStr] = input.split(",").map((s) => s.trim());
  if (latStr === undefined || lonStr === undefined) {
    throw new Error(`Expected "lat,lon" but got "${input}"`);
  }
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Invalid coordinates: "${input}"`);
  }
  if (lat < -90 || lat > 90) throw new Error("Latitude out of range [-90, 90]");
  if (lon < -180 || lon > 180) throw new Error("Longitude out of range [-180, 180]");
  // convert into signed 32‑bit integers representing degrees × 1e7.  The
  // contract stores lat/lon as int32, so we clamp to that range.
  const latE7 = Math.round(lat * 1e7);
  const lonE7 = Math.round(lon * 1e7);
  if (latE7 < -2147483648 || latE7 > 2147483647) throw new Error("latE7 out of int32 range");
  if (lonE7 < -2147483648 || lonE7 > 2147483647) throw new Error("lonE7 out of int32 range");
  return { latE7, lonE7 };
}

/**
 * Parse a human‑readable HB token amount into a BigInt with 18 decimals
 * (the Hummingbird contract and HBToken use 18 decimals).  Accepts
 * decimal strings such as "0.5" or "1.25".
 */
function parseHB(input: string): bigint {
  return ethers.parseUnits(input, 18);
}

/**
 * Parse an expiry timestamp or relative expiry in seconds.  Passing
 * nothing or an empty string returns 0 (no expiry).  Passing a value
 * greater than ~2e9 is treated as an absolute UNIX timestamp; smaller
 * values are treated as a relative offset from now.
 */
function parseExpires(input?: string): bigint {
  if (!input || input.trim() === "") return 0n;
  const v = Number(input);
  if (!Number.isFinite(v) || v < 0) throw new Error("expires must be >= 0 seconds (unix ts or delta)");
  const now = Math.floor(Date.now() / 1000);
  const abs = v > 2_000_000_000 ? v : now + v;
  return BigInt(abs);
}

/**
 * Resolve the deployed Hummingbird contract using either an explicit
 * contract address or the HUMMINGBIRD environment variable.  Optionally
 * returns the contract instance connected to a specific signer.
 */
async function getHB(
  hre: HardhatRuntimeEnvironment,
  signerName?: string,
  addrArg?: string,
): Promise<Contract> {
  const { ethers: hhEthers, artifacts } = hre;
  const [defaultSigner] = await hhEthers.getSigners();
  const signer = signerName ? await hhEthers.getSigner(signerName) : defaultSigner;
  const artifact = await artifacts.readArtifact("Hummingbird");
  const addr = addrArg || process.env.HUMMINGBIRD || (hre.network.config as any).hummingbird;
  if (!addr) throw new Error("HUMMINGBIRD address not provided (--contract or env HUMMINGBIRD).");
  return new hhEthers.Contract(addr, artifact.abi, signer);
}

// -------------------------------------------------------------------------
// Task definitions
//
// Each task is documented inline using Hardhat's task DSL.  Tasks are
// grouped by their purpose: request creation/cancellation, query helpers,
// drone/requester actions, and composite flows.  See the README for
// examples of invoking these from the command line.

// Create a delivery request (optionally targeted to a specific drone).
task("hb:request", "Create a delivery request (optionally targeted to a drone)")
  .addParam("pickup", 'Pickup "lat,lon" in degrees (e.g. "42.3601,-71.0589")')
  .addParam("drop", 'Drop‑off "lat,lon" in degrees')
  .addOptionalParam("device", "Targeted drone device address (ioID/device). Use 0x0 for open.", ZERO)
  .addOptionalParam("expires", "Expiry (unix seconds or seconds‑from‑now). Omit for no expiry.", "")
  .addParam("maxhb", "Maximum price in HB tokens (e.g. 1.5)")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Hardhat account name to send the tx from")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const { latE7: pLat, lonE7: pLon } = parseLatLon(args.pickup);
    const { latE7: dLat, lonE7: dLon } = parseLatLon(args.drop);
    const device = (args.device ?? ZERO) as AddressLike;
    const expiresAt = parseExpires(args.expires);
    const maxPrice = parseHB(args.maxhb);
    const tx = await hb.requestDelivery(pLat, pLon, dLat, dLon, device, expiresAt, maxPrice);
    console.log(`Submitting delivery request... (tx: ${tx.hash})`);
    const rc = await tx.wait();
    // Try to decode the DeliveryRequested event from the receipt.  If it
    // doesn't exist (e.g. older contract), just log the transaction hash.
    const iface = hb.interface;
    let id: string | null = null;
    for (const log of rc.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "DeliveryRequested") {
          id = parsed.args.id.toString();
          break;
        }
      } catch {
        // ignore parse errors
      }
    }
    if (id) {
      console.log(`Request created: id=${id}`);
      console.log(`Targeted: ${device !== ZERO}`);
      console.log(`ExpiresAt: ${expiresAt.toString()}`);
      console.log(`MaxPrice (HB): ${args.maxhb}`);
    } else {
      console.log(`Request submitted; transaction mined.`);
    }
  });

// Cancel an existing request.  This can be called by the requester at any
// time before the request is accepted or within the 2‑minute grace
// period after acceptance.
task("hb:cancel", "Cancel a delivery request")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Hardhat account name to send the tx from")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const tx = await hb.cancelRequest(BigInt(args.id));
    console.log(`Cancelling request ${args.id}... (tx: ${tx.hash})`);
    await tx.wait();
    console.log(`Cancelled request ${args.id}`);
  });

// Convert a targeted request into a fully open request.  Only the
// requester may call this on a request that is currently targeted and
// still open.
task("hb:open-target", "Convert a targeted request into an open request")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Hardhat account name to send the tx from")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const tx = await hb.openTarget(BigInt(args.id));
    console.log(`Opening targeted request ${args.id} to all... (tx: ${tx.hash})`);
    await tx.wait();
    console.log(`Request ${args.id} is now open to all drones`);
  });

// Query the full delivery request struct and display a more legible
// representation of the on‑chain data (including stringified status).
task("hb:status", "Show request details and status")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, undefined, args.contract);
    const r = await hb.getRequest(BigInt(args.id));
    console.log({
      id: r.id.toString(),
      requester: r.requester,
      pickupLatE7: r.pickupLatE7.toString(),
      pickupLonE7: r.pickupLonE7.toString(),
      dropLatE7: r.dropLatE7.toString(),
      dropLonE7: r.dropLonE7.toString(),
      price: r.price.toString(),
      proposedPrice: r.proposedPrice.toString(),
      drone: r.drone,
      status: statusName(r.status),
      targetedDevice: r.targetedDevice,
      expiresAt: r.expiresAt.toString(),
      maxPrice: r.maxPrice.toString(),
      requestedAt: r.requestedAt.toString(),
      proposedAt: r.proposedAt.toString(),
      acceptedAt: r.acceptedAt.toString(),
    });
  });

// List all open request IDs along with status and assigned drone (if any).
task("hb:list-open", "List all open delivery request ids")
  .addOptionalParam("contract", "Hummingbird contract address")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, undefined, args.contract);
    const ids: bigint[] = await hb.getOpenRequests();
    if (ids.length === 0) {
      console.log("(no open requests)");
      return;
    }
    for (const id of ids) {
      const r = await hb.getRequest(id);
      console.log(
        `id=${id.toString()} status=${statusName(r.status)} drone=${r.drone} expiresAt=${r.expiresAt.toString()}`,
      );
    }
  });

  // List all open request IDs along with status and assigned drone (if any).
task("hb:list-ongoing", "List all ongoing delivery request ids")
  .addOptionalParam("contract", "Hummingbird contract address")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, undefined, args.contract);
    const ids: bigint[] = await hb.getOngoingRequests();
    if (ids.length === 0) {
      console.log("(no open requests)");
      return;
    }
    for (const id of ids) {
      const r = await hb.getRequest(id);
      console.log(
        `id=${id.toString()} status=${statusName(r.status)} drone=${r.drone} expiresAt=${r.expiresAt.toString()}`,
      );
    }
  });

// List open (targeted) requests for a particular device.  Only shows
// requests that are targeted to the given device and still open/valid.
task("hb:list-open-for", "List open (targeted) requests for a device")
  .addParam("device", "Target device address")
  .addOptionalParam("contract", "Hummingbird contract address")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, undefined, args.contract);
    const ids: bigint[] = await hb.getOpenRequestsFor(args.device);
    if (ids.length === 0) {
      console.log("(none)");
      return;
    }
    for (const id of ids) {
      const r = await hb.getRequest(id);
      console.log(
        `id=${id.toString()} status=${statusName(r.status)} expiresAt=${r.expiresAt.toString()}`,
      );
    }
  });

// List request IDs created by a particular requester.  Defaults to the
// current signer if no requester is specified.
task("hb:my-requests", "List request ids created by an address (default signer)")
  .addOptionalParam("requester", "Requester address (defaults to active signer)")
  .addOptionalParam("contract", "Hummingbird contract address")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, undefined, args.contract);
    const requester = args.requester || (await hb.runner?.getAddress?.());
    if (!requester) {
      throw new Error("cannot resolve requester; pass --requester");
    }
    const ids: bigint[] = await hb.getMyRequests(requester);
    if (ids.length === 0) {
      console.log("(none)");
      return;
    }
    console.log(ids.map((x) => x.toString()).join(", "));
  });

// Propose delivery as a drone.  The drone must be an authorized device
// according to the ioID registry.  Accepts a price in HB tokens.
task("hb:propose", "Propose delivery as a drone (price in HB)")
  .addParam("id", "Request id")
  .addParam("pricehb", "Proposed price in HB tokens (e.g. 0.7)")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Drone signer/account to use")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const price = parseHB(args.pricehb);
    const tx = await hb.proposeDelivery(BigInt(args.id), price);
    console.log(`Proposing delivery for id=${args.id} with price(HB)=${args.pricehb}... (tx: ${tx.hash})`);
    await tx.wait();
    console.log(`Proposed id=${args.id} price(HB)=${args.pricehb}`);
  });

// Accept a proposed delivery as the requester.
task("hb:accept", "Accept a proposed delivery as requester")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Requester signer/account to use")
  .setAction(async (args, hre) => {
    // When accepting a delivery, the requester must escrow the proposed
    // price in HB tokens.  To avoid a failed call due to insufficient
    // allowance, this task first reads the request to determine the
    // proposed price and, if necessary, approves the Hummingbird
    // contract to transfer the required amount on behalf of the
    // requester.
    const hb = await getHB(hre, args.signer, args.contract);
    const id = BigInt(args.id);
    // Fetch the current request to get the proposed price.  If the
    // status is not Proposed or the price is zero, we still proceed
    // (hb.acceptDelivery will revert appropriately).
    const req = await hb.getRequest(id);
    const price: bigint = req.proposedPrice ?? req.price ?? 0n;
    // Determine the signer (requester) and the Hummingbird contract
    // address for allowance checks.  In ethers v6, getAddress() returns
    // the target address; fallback to .target or .address if needed.
    const signer = hb.runner as any;
    const ownerAddr: string = await (signer.getAddress ? signer.getAddress() : signer.address);
    const hbAddr: string = (typeof hb.getAddress === "function" ? await hb.getAddress() : (hb.target ?? hb.address));
    // Look up the HB token address from the contract's public variable.
    const tokenAddr: string = await (hb as any).hbToken();
    // Minimal ERC20 interface for allowance and approve.  We avoid
    // importing artifacts here to keep the task self‑contained.
    const erc20Abi = [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)"
    ];
    const token = new ethers.Contract(tokenAddr, erc20Abi, signer);
    // Check current allowance and top up if necessary.  Only perform the
    // approval if price > 0; zero‑value approvals are unnecessary and
    // some ERC20s may revert on them.
    if (price > 0n) {
      const current: bigint = await token.allowance(ownerAddr, hbAddr);
      if (current < price) {
        console.log(
          `Current HB allowance (${current.toString()}) is below proposed price (${price.toString()}); approving ...`,
        );
        const approveTx = await token.approve(hbAddr, price);
        console.log(`→ approve tx: ${approveTx.hash}`);
        // Wait for the approval to be mined to ensure allowance is set.
        if (approveTx && typeof approveTx.wait === "function") {
          await approveTx.wait();
        }
        console.log(`Approved ${price.toString()} tokens for Hummingbird`);
      }
    }
    // Now accept the delivery.  This will transfer `price` HB from the
    // requester into the contract.  If the allowance is insufficient,
    // the call will revert.
    const tx = await hb.acceptDelivery(id);
    console.log(`Accepting proposal for id=${args.id}... (tx: ${tx.hash})`);
    if (tx && typeof tx.wait === "function") {
      await tx.wait();
    }
    console.log(`Accepted id=${args.id}`);
  });

// Progress functions: start, picked, dropped, complete.  These are
// separated into distinct tasks but can also be invoked sequentially via
// hb:progress.
task("hb:start", "Start an accepted delivery (drone)")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Drone signer/account to use")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const tx = await hb.startDelivery(BigInt(args.id));
    console.log(`Starting delivery id=${args.id}... (tx: ${tx.hash})`);
    await tx.wait();
    console.log(`Started id=${args.id}`);
  });

task("hb:picked", "Mark package picked (drone)")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Drone signer/account")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const tx = await hb.packagePicked(BigInt(args.id));
    console.log(`Marking package picked for id=${args.id}... (tx: ${tx.hash})`);
    await tx.wait();
    console.log(`Picked id=${args.id}`);
  });

task("hb:dropped", "Mark package dropped (drone)")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Drone signer/account")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const tx = await hb.packageDropped(BigInt(args.id));
    console.log(`Marking package dropped for id=${args.id}... (tx: ${tx.hash})`);
    await tx.wait();
    console.log(`Dropped id=${args.id}`);
  });

task("hb:complete", "Complete a delivery (drone)")
  .addParam("id", "Request id")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Drone signer/account")
  .setAction(async (args, hre) => {
    const hb = await getHB(hre, args.signer, args.contract);
    const tx = await hb.completeDelivery(BigInt(args.id));
    console.log(`Completing delivery id=${args.id}... (tx: ${tx.hash})`);
    await tx.wait();
    console.log(`Completed id=${args.id}`);
  });

// Composite task: progress a delivery from accepted through completed
// status with configurable delays between each step.  This is useful
// during development/testing to simulate the drone performing each
// action in sequence.  The default delay is 5 seconds between
// transitions; set --delay to zero for immediate progression.
task("hb:progress", "Progress an accepted delivery through all steps")
  .addParam("id", "Request id")
  .addOptionalParam("delay", "Delay (in milliseconds) between steps", "5000")
  .addOptionalParam("contract", "Hummingbird contract address")
  .addOptionalParam("signer", "Drone signer/account")
  .setAction(async (args, hre) => {
    const delayMs = Number(args.delay);
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error("delay must be a non‑negative number of milliseconds");
    }
    const hb = await getHB(hre, args.signer, args.contract);
    const id = BigInt(args.id);
    // helper function to sleep; Hardhat tasks run in Node.js so we can use
    // a Promise wrapper around setTimeout.
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    // Start
    let tx = await hb.startDelivery(id);
    console.log(`Progress: startDelivery (tx: ${tx.hash})`);
    await tx.wait();
    console.log("→ delivery started");
    if (delayMs > 0) await sleep(delayMs);
    // Picked
    tx = await hb.packagePicked(id);
    console.log(`Progress: packagePicked (tx: ${tx.hash})`);
    await tx.wait();
    console.log("→ package picked");
    if (delayMs > 0) await sleep(delayMs);
    // Dropped
    tx = await hb.packageDropped(id);
    console.log(`Progress: packageDropped (tx: ${tx.hash})`);
    await tx.wait();
    console.log("→ package dropped");
    if (delayMs > 0) await sleep(delayMs);
    // Complete
    tx = await hb.completeDelivery(id);
    console.log(`Progress: completeDelivery (tx: ${tx.hash})`);
    await tx.wait();
    console.log("→ delivery completed");
  });
