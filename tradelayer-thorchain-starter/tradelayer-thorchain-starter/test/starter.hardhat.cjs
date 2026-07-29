const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("starter mocks", function () {
  it("registers and absorbs a fake utxo", async function () {
    const [deployer] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("MockUTXORegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const Ingress = await ethers.getContractFactory("MockTradeLayerIngress");
    const ingress = await Ingress.deploy();
    await ingress.waitForDeployment();

    const txid = ethers.keccak256(ethers.toUtf8Bytes("btc tx"));
    const regTx = await registry.register(txid, 0, 100_000n, deployer.address);
    await regTx.wait();

    const utxoRef = await registry.computeRef(txid, 0);
    const absorbTx = await ingress.absorbUtxoRef(utxoRef, 100_000n, "0x1234");
    await absorbTx.wait();

    const rec = await ingress.absorbed(0);
    expect(rec.utxoRef).to.equal(utxoRef);
    expect(rec.sats).to.equal(100_000n);
  });
});
