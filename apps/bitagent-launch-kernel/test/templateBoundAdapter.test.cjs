const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TemplateBoundThorchainDepositAdapter", function () {
  it("stores a native template-bound deposit commitment and forwards router call", async function () {
    const [deployer] = await ethers.getSigners();

    const Router = await ethers.getContractFactory("MockThorchainRouter");
    const router = await Router.deploy();
    await router.waitForDeployment();

    const Adapter = await ethers.getContractFactory("TemplateBoundThorchainDepositAdapter");
    const adapter = await Adapter.deploy(await router.getAddress());
    await adapter.waitForDeployment();

    const memo = "=:b:bc1qexample:0/1/0";
    const templateHash = ethers.keccak256(ethers.toUtf8Bytes("template"));
    const destinationScriptCommitment = ethers.keccak256(ethers.toUtf8Bytes("bc1qexample"));
    const amount = ethers.parseEther("0.01");

    const tx = await adapter.depositNativeWithTemplate(
      deployer.address,
      amount,
      memo,
      123456n,
      templateHash,
      destinationScriptCommitment,
      0,
      214,
      1,
      1,
      { value: amount }
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try {
          return adapter.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "TemplateBoundSwapCommitted");

    expect(event).to.not.equal(undefined);
    const depositId = event.args.depositId;
    const stored = await adapter.templateBoundDeposits(depositId);
    expect(stored.templateHash).to.equal(templateHash);
    expect(stored.thorMemoHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(memo)));
    expect(stored.receiptPropertyId).to.equal(214);
  });

  it("stores an ERC20 template-bound deposit commitment and forwards router call", async function () {
    const [deployer] = await ethers.getSigners();

    const Router = await ethers.getContractFactory("MockThorchainRouter");
    const router = await Router.deploy();
    await router.waitForDeployment();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock USDC", "mUSDC");
    await token.waitForDeployment();

    const Adapter = await ethers.getContractFactory("TemplateBoundThorchainDepositAdapter");
    const adapter = await Adapter.deploy(await router.getAddress());
    await adapter.waitForDeployment();

    const amount = 1_000_000n;
    await token.mint(deployer.address, amount);
    await token.approve(await adapter.getAddress(), amount);

    const memo = "=:b:bc1qexample:0/1/0";
    const templateHash = ethers.keccak256(ethers.toUtf8Bytes("template"));
    const destinationScriptCommitment = ethers.keccak256(ethers.toUtf8Bytes("bc1qexample"));

    const tx = await adapter.depositErc20WithTemplate(
      deployer.address,
      await token.getAddress(),
      amount,
      memo,
      123456n,
      templateHash,
      destinationScriptCommitment,
      0,
      214,
      1,
      1
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try {
          return adapter.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "TemplateBoundSwapCommitted");

    expect(event).to.not.equal(undefined);
    const depositId = event.args.depositId;
    const stored = await adapter.templateBoundDeposits(depositId);
    expect(stored.asset).to.equal(await token.getAddress());
    expect(stored.amount).to.equal(amount);
    expect(stored.destinationChain).to.equal(0);
  });
});
