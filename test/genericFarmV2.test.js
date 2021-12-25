const { expect, assert } = require("chai")
const { time, prepare, deploy, getBigNumber, ADDRESS_ZERO } = require("./utilities")

const ACC_TOKEN_PRECISION = 18

// alice is a default Signer, so assume all calls are made by alice unless it's specified otherwise with "connect"

describe("genericFarmV2", function () {
  before(async function () {
    await prepare(this, ['ERC20Mock', 'genericFarmV2'])
  })

  beforeEach(async function () {
    await deploy(this, [
      ["token", this.ERC20Mock, ["Token", "Token", getBigNumber(10,64)]]
    ])

    // lp_small will represent LPs with low prices (aka UNI/Sushi/Bancor)
    // lp_large will represent LPs with high prices (aka 1inch/Balancer)
    await deploy(this, [
      ["lps", this.ERC20Mock, ["LP Small", "LPS", getBigNumber(10,64)]],
      ["lph", this.ERC20Mock, ["LP High", "LPH", getBigNumber(10,64)]]
    ])

    expect((await this.token.decimals())).to.be.equal(18);

    await deploy(this, [
        ['farm', this.genericFarmV2, [this.token.address, getBigNumber(1,18)]] // reward = 1 Token per block 
    ])

    expect((await this.farm.REWARD_TOKEN())).to.be.equal(this.token.address);

    await this.token.transfer(this.farm.address, getBigNumber(1,18).mul(1000))
  })

  describe("PoolLength", function () {
    it("PoolLength should execute", async function () {
      await this.farm.add(10, this.lps.address)
      expect((await this.farm.poolLength())).to.be.equal(1);
    })
  })

  describe("Change Owner", function () {
    it("Non owner is not allowed to create pools", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      const msg1 = "Ownable: caller is not the owner";

      await expect(this.farm.connect(bob).add(10, this.lps.address)).to.be.revertedWith(msg1);
    })

    it("Owner changed and can create pools now", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      await this.farm.transferOwnership(bob.address, true, true);

      await this.farm.connect(bob).add(10, this.lps.address)
      expect((await this.farm.poolLength())).to.be.equal(1);
    })
  })

  describe("Set", function() {
    it("Should emit event LogSetPool", async function () {
      await this.farm.add(10, this.lps.address)
      await expect(this.farm.set(0, 10))
            .to.emit(this.farm, "LogSetPool")
            .withArgs(0, 10)
    })
    it("Changing allocPoints for all pools affect pending rewards", async function () {
      await this.farm.add(10, this.lps.address)
      await this.farm.add(10, this.lph.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.lph.approve(this.farm.address, getBigNumber(10))

      let l1 = await this.farm.batch(
        [
            this.farm.interface.encodeFunctionData("deposit", [0, getBigNumber(2,3), this.alice.address]),
            this.farm.interface.encodeFunctionData("deposit", [1, getBigNumber(2,3), this.bob.address]),
        ],
        true
      )
      await time.advanceBlock()

      let l2 = await this.farm.batch(
        [
            this.farm.interface.encodeFunctionData("set", [0, 25]),
            this.farm.interface.encodeFunctionData("set", [1, 75]),
        ],
        true
      )
      pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)
      pendingRewardForBob = await this.farm.pendingReward(1, this.bob.address)

      let expectedRewardForAlice = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber).mul(25).div(100)
      let expectedRewardForBob = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber).mul(75).div(100)
      expect(pendingRewardForBob).to.be.equal(expectedRewardForBob)
      expect(pendingRewardForAlice).to.be.equal(expectedRewardForAlice)
    })
    it("Changing allocPoints for a pool affect pending rewards for all pools", async function () {
      await this.farm.add(10, this.lps.address)
      await this.farm.add(10, this.lph.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.lph.approve(this.farm.address, getBigNumber(10))

      let l1 = await this.farm.batch(
        [
            this.farm.interface.encodeFunctionData("deposit", [0, getBigNumber(2,3), this.alice.address]),
            this.farm.interface.encodeFunctionData("deposit", [1, getBigNumber(2,3), this.bob.address]),
        ],
        true
      )
      await time.advanceBlock()

      let l2 = await this.farm.set(1, 20)

      pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)
      pendingRewardForBob = await this.farm.pendingReward(1, this.bob.address)

      let expectedRewardForAlice = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber).mul(1).div(3)
      let expectedRewardForBob = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber).mul(2).div(3)
      expect(pendingRewardForBob).to.be.equal(expectedRewardForBob)
      expect(pendingRewardForAlice).to.be.equal(expectedRewardForAlice)
    })
  })

  describe("Combining Transactions", function() {
    it("Claim and Withdraw in one batch", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))

      let l1 = await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()

      let rewardForAlice = await this.farm.pendingReward(0, this.alice.address)
      let l2 = await this.farm.batch(
        [
            this.farm.interface.encodeFunctionData("harvest", [0, this.bob.address]),
            this.farm.interface.encodeFunctionData("withdraw", [0, getBigNumber(1,3), this.bob.address]),
        ],
        true
      )
      let pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)
      expect(pendingRewardForAlice).to.be.equal(0)

      let bl = await this.lps.balanceOf(this.bob.address)
      expect(bl).to.be.equal(getBigNumber(1,3))

      let reward1 = await this.token.balanceOf(this.bob.address)
      expect(reward1).to.be.equal(rewardForAlice.add(getBigNumber(1,18)))

    })
  })

  describe("setRewardTokensPerBlock", function() {
    it("Changing rewardTokensPerBlock with _update flag OFF affects previously accumulated rewards", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()

      let l2 = await this.farm.setRewardTokensPerBlock(getBigNumber(5,17), false) // halfing rewardTokensPerBlock

      pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)

      let expectedRewardForAlice = getBigNumber(5,17).mul(l2.blockNumber - l1.blockNumber) // using 1/2 reward token per block here
      expect(pendingRewardForAlice).to.be.equal(expectedRewardForAlice)
    })
    it("Changing rewardTokensPerBlock with _update flag ON does not affects previously accumulated rewards", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()

      let l2 = await this.farm.setRewardTokensPerBlock(getBigNumber(5,17), true) // halfing rewardTokensPerBlock

      pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)

      let expectedRewardForAlice = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber) // still using 1 reward token per block here
      expect(pendingRewardForAlice).to.be.equal(expectedRewardForAlice)
    })
    it("Changing rewardTokensPerBlock only affects rewards after the last pool update", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(1,18), this.alice.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()

      let l2 = await this.farm.updatePool(0)
      let l3 = await this.farm.setRewardTokensPerBlock(getBigNumber(5,17), false) // halfing rewardTokensPerBlock

      let pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)

      let expectedRewardForAlice = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber).
        add(getBigNumber(5,17).mul(l3.blockNumber - l2.blockNumber))
      expect(pendingRewardForAlice).to.be.equal(expectedRewardForAlice)
    })
    it("setRewardTokensPerBlock emits an event", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()

      await expect(this.farm.setRewardTokensPerBlock(getBigNumber(5,17), false))
      .to.emit(this.farm, "SetRewardTokensPerBlock")
      .withArgs(getBigNumber(5,17), false)
    })
})

  describe("pendingReward", function() {
    it("pendingReward should equal expectedReward", async function () {
      // create pool
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))

      // farm deposits LPs to the pool for Alice
      let log = await this.farm.deposit(0, getBigNumber(1), this.alice.address)
      await time.advanceBlock();
      let log2 = await this.farm.updatePool(0);
      
      await time.advanceBlock()
      let expectedReward = getBigNumber(1,18).mul(log2.blockNumber + 1 - log.blockNumber)
      let pendingReward = await this.farm.pendingReward(0, this.alice.address)
      expect(pendingReward).to.be.equal(expectedReward)
    })
    it("When block is lastRewardBlock", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(1), this.alice.address)
      await time.advanceBlockTo(l1.blockNumber + 3) // advance 3 blocks ahead
      let l2 = await this.farm.updatePool(0)
      let expectedReward = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber)
      let pendingReward = await this.farm.pendingReward(0, this.alice.address)
      expect(pendingReward).to.be.equal(expectedReward)
    })
  })

  describe("General pool's accRewardTokensPerShare Calculatons", function () {
    it("with one pool", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let lp_decimals = 12
      await this.farm.deposit(0, getBigNumber(1,lp_decimals), this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool = await this.farm.poolInfo(0);
      let accRewardTokensPerShare_decimals = ACC_TOKEN_PRECISION - lp_decimals + 18 // 18 for reward token
      expect(pool.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals))
    })
    it("with two pools", async function () {
      await this.farm.add(10, this.lps.address)
      await this.farm.add(10, this.lph.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.lph.approve(this.farm.address, getBigNumber(10))
      let lps_decimals = 12
      let lph_decimals = 3

      await this.farm.deposit(0, getBigNumber(1,lps_decimals), this.alice.address)
      await this.farm.deposit(1, getBigNumber(1,lph_decimals), this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)
      await this.farm.updatePool(1)

      let pool0 = await this.farm.poolInfo(0);
      let pool1 = await this.farm.poolInfo(1);

      // 3 blocks between deposit and update for each pool, allocation split in 2 (* 10 / 20) because of 2 pools 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(3,accRewardTokensPerShare_decimals_0).mul(10).div(20))
      let accRewardTokensPerShare_decimals_1 = ACC_TOKEN_PRECISION - lph_decimals + 18 // 18 for reward token
      expect(pool1.accRewardTokensPerShare).to.be.equal(getBigNumber(3,accRewardTokensPerShare_decimals_1).mul(10).div(20))
    })
  })
  
  describe("MassUpdatePools", function () {
    it("with one pool", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let lp_decimals = 12
      await this.farm.deposit(0, getBigNumber(1,lp_decimals), this.alice.address)
      await time.advanceBlock()
      await this.farm.massUpdatePools([0])

      let pool = await this.farm.poolInfo(0);
      let accRewardTokensPerShare_decimals = ACC_TOKEN_PRECISION - lp_decimals + 18 // 18 for reward token
      expect(pool.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals))
    })

    it("Updating invalid pools should fail", async function () {
      await expect(this.farm.massUpdatePools([0, 10000])).to.be.reverted; // pool 10000 doesn't exist
    })

    it("with two pools", async function () {
      await this.farm.add(10, this.lps.address)
      await this.farm.add(10, this.lph.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.lph.approve(this.farm.address, getBigNumber(10))
      let lps_decimals = 12
      let lph_decimals = 3

      await this.farm.deposit(0, getBigNumber(1,lps_decimals), this.alice.address)
      await this.farm.deposit(1, getBigNumber(1,lph_decimals), this.alice.address)
      await time.advanceBlock()
      await this.farm.massUpdatePools([0,1])

      let pool0 = await this.farm.poolInfo(0);
      let pool1 = await this.farm.poolInfo(1);

      // 3 blocks between deposit and update for pool0 and 2 blocks for pool1, 
      // allocation split in 2 (* 10 / 20) because of 2 pools 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(3,accRewardTokensPerShare_decimals_0).mul(10).div(20))
      let accRewardTokensPerShare_decimals_1 = ACC_TOKEN_PRECISION - lph_decimals + 18 // 18 for reward token
      expect(pool1.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_1).mul(10).div(20))
    })
  })

  describe("MassUpdateAllPools", function () {
    it("with two pools", async function () {
      await this.farm.add(10, this.lps.address)
      await this.farm.add(10, this.lph.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.lph.approve(this.farm.address, getBigNumber(10))
      let lps_decimals = 12
      let lph_decimals = 3

      await this.farm.deposit(0, getBigNumber(1,lps_decimals), this.alice.address)
      await this.farm.deposit(1, getBigNumber(1,lph_decimals), this.alice.address)
      await time.advanceBlock()
      await this.farm.massUpdateAllPools()

      let pool0 = await this.farm.poolInfo(0);
      let pool1 = await this.farm.poolInfo(1);

      // 3 blocks between deposit and update for pool0 and 2 blocks for pool 1, 
      // allocation split in 2 (* 10 / 20) because of 2 pools 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(3,accRewardTokensPerShare_decimals_0).mul(10).div(20))
      let accRewardTokensPerShare_decimals_1 = ACC_TOKEN_PRECISION - lph_decimals + 18 // 18 for reward token
      expect(pool1.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_1).mul(10).div(20))
    })
  })

  
  describe("Add", function () {
    it("Should add two new pools", async function () {
      await expect(this.farm.add(10, this.lps.address))
            .to.emit(this.farm, "LogPoolAddition")
            .withArgs(0, 10, this.lps.address)
      await expect(this.farm.add(10, this.lph.address))
            .to.emit(this.farm, "LogPoolAddition")
            .withArgs(1, 10, this.lph.address)
    })
    it("Should not allow adding the same LP twice", async function () {
      const msg1 = "genericFarmV2::there is already a pool with this LP";

      await expect(this.farm.add(10, this.lps.address))
            .to.emit(this.farm, "LogPoolAddition")
            .withArgs(0, 10, this.lps.address)
      await expect(this.farm.add(10, this.lph.address))
            .to.emit(this.farm, "LogPoolAddition")
            .withArgs(1, 10, this.lph.address)

      await expect(this.farm.add(10, this.lps.address)).to.be.revertedWith(msg1);
    })
  })

  describe("UpdatePool", function () {
    it("Should emit event LogUpdatePool", async function () {
      await this.farm.add(10, this.lps.address)
      await time.advanceBlock()
      await expect(this.farm.updatePool(0))
            .to.emit(this.farm, "LogUpdatePool")
            .withArgs(0, (await this.farm.poolInfo(0)).lastRewardBlock,
              (await this.lps.balanceOf(this.farm.address)),
              (await this.farm.poolInfo(0)).accRewardTokensPerShare)
    })

    it("Should take else path", async function () {
      await this.farm.add(10, this.lps.address)
      await time.advanceBlock()
      await this.farm.batch(
          [
              this.farm.interface.encodeFunctionData("updatePool", [0]),
              this.farm.interface.encodeFunctionData("updatePool", [0]),
          ],
          true
      )
    })
  })

  describe("TotalAllocPoint", function () {
    it("UpdatePool tolerates totalAllocPoint to be zero, ", async function () {
      await this.farm.add(0, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)
    })
    it("Pending ICHI and ICHI rewards are 0 when totalAllocPoint is zero, ", async function () {
      await this.farm.add(0, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let tap = await this.farm.totalAllocPoint()
      expect(tap).to.be.equal(0)

      let poolReward = await this.farm.poolReward(0)
      expect(poolReward).to.be.equal(0)

      pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)
      expect(pendingRewardForAlice).to.be.equal(0)
    })
    it("poolReward, ", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()
      let reward = await this.farm.poolReward(0)
      expect(reward).to.be.equal(getBigNumber(1,18))
    })
  })

  describe("Deposit", function () {
    it("Should emit event Deposit", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await expect(this.farm.deposit(0, getBigNumber(1,3), this.alice.address))
            .to.emit(this.farm, "Deposit")
            .withArgs(this.alice.address, 0, 1000, this.alice.address)
    })
    it("getLPSupply", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      let lpSupply = await this.farm.getLPSupply(0)
      expect(lpSupply).to.be.equal(getBigNumber(1,3))
    })
    it("Depositing into non-existent pool should fail", async function () {
      await expect(this.farm.deposit(1001, getBigNumber(0), this.alice.address)).to.be.reverted;
    })
    it("Adding more LPs increases rewards ratio (with two users)", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let al1 = await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      let bl1 = await this.farm.deposit(0, getBigNumber(2,3), this.bob.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()
      let bl2 = await this.farm.deposit(0, getBigNumber(4,3), this.bob.address)
      await time.advanceBlock()

      pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)
      pendingRewardForBob = await this.farm.pendingReward(0, this.bob.address)
      let expectedRewardForAlice = getBigNumber(1,18).mul(bl1.blockNumber - al1.blockNumber).
        add(getBigNumber(1,18).mul(bl2.blockNumber - bl1.blockNumber).div(2)).
        add(getBigNumber(1,18).mul(1).div(4))
      let expectedRewardForBob = getBigNumber(1,18).mul(bl2.blockNumber - bl1.blockNumber).div(2).
        add(getBigNumber(1,18).mul(3).div(4))
      expect(pendingRewardForBob).to.be.equal(expectedRewardForBob)
      expect(pendingRewardForAlice).to.be.equal(expectedRewardForAlice)
    })
    it("Moving LPs from one acct to another keeps the rewards intact", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let al1 = await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      let bl1 = await this.farm.deposit(0, getBigNumber(2,3), this.bob.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()
      let al2 = await this.farm.withdraw(0, getBigNumber(1,3), this.bob.address)
      let bl2 = await this.farm.deposit(0, getBigNumber(1,3), this.bob.address)
      await time.advanceBlock()

      pendingRewardForAlice = await this.farm.pendingReward(0, this.alice.address)
      pendingRewardForBob = await this.farm.pendingReward(0, this.bob.address)
      let expectedRewardForAlice = getBigNumber(1,18).mul(bl1.blockNumber - al1.blockNumber).
        add(getBigNumber(1,18).mul(al2.blockNumber - bl1.blockNumber).div(2)).
        add(getBigNumber(1,18).mul(bl2.blockNumber - al2.blockNumber).mul(1).div(3)).
        add(getBigNumber(1,18).mul(1).div(4))
      let expectedRewardForBob = getBigNumber(1,18).mul(al2.blockNumber - bl1.blockNumber).div(2).
        add(getBigNumber(1,18).mul(bl2.blockNumber - al2.blockNumber).mul(2).div(3)).
        add(getBigNumber(1,18).mul(3).div(4))
      expect(pendingRewardForBob).to.be.equal(expectedRewardForBob)
      expect(pendingRewardForAlice).to.be.equal(expectedRewardForAlice)
    })
    it("Deposit to another account", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      // alice deposits to bob's account
      let bl1 = await this.farm.deposit(0, getBigNumber(2,3), this.bob.address)
      await time.advanceBlock()

      let u1 = await this.farm.userInfo(0,this.bob.address)
      expect(u1.amount).to.be.equal(getBigNumber(2,3))
    })
    it("Can deposit on top of existing balance", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      await time.advanceBlock()
      await this.farm.deposit(0, getBigNumber(4,3), this.alice.address)

      let u1 = await this.farm.userInfo(0,this.alice.address)
      expect(u1.amount).to.be.equal(getBigNumber(6,3))
    })
  })

  describe("Non Reentrant", function () {
    it("Should block the farm", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))

      const msg1 = 'Ownable: caller is not the owner';
      await expect(this.farm.connect(this.bob).setNonReentrant(true)).to.be.revertedWith(msg1);

      await this.farm.setNonReentrant(true)

      const msg2 = 'genericFarmV2::nonReentrant - try again';
      await expect(this.farm.deposit(0, getBigNumber(1,3), this.alice.address)).to.be.revertedWith(msg2);
      await expect(this.farm.withdraw(0, getBigNumber(1,3), this.alice.address)).to.be.revertedWith(msg2);
      await expect(this.farm.harvest(0, this.alice.address)).to.be.revertedWith(msg2);

      await this.farm.setNonReentrant(false)

      await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)

    })
  })


  describe("accRewardTokensPerShare Calculations for various LPs", function () {
    // approximate LP prices:
    // 1 SLP = $360000
    // 1 1inch LP = $20
    // 1 Balancer LP = $120
    it("Base/Normal Case", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let lps_value = 100
      //console.log("to deposit = "+getBigNumber(lps_value,lps_decimals))

      await this.farm.deposit(0, getBigNumber(lps_value,lps_decimals), this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_0).div(lps_value))
    })
    it("Angel Vault $100", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 100
      let usd_per_lp = 3600000000
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      let pendingReward = await this.farm.pendingReward(0, this.alice.address)

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      let difference = getBigNumber(pool0.accRewardTokensPerShare,0).sub(getBigNumber(2,accRewardTokensPerShare_decimals_0).mul(usd_per_lp).div(num_usd))

      expect(difference).to.be.lt(getBigNumber(1,17)) 
      expect(getBigNumber(2,18).sub(pendingReward)).to.be.lt(10) 
    })
    it("SLP $1000", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 1000
      let usd_per_lp = 360000
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      let pendingReward = await this.farm.pendingReward(0, this.alice.address)

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      let difference = getBigNumber(pool0.accRewardTokensPerShare,0).sub(getBigNumber(2,accRewardTokensPerShare_decimals_0).mul(usd_per_lp).div(num_usd))

      expect(difference).to.be.lt(getBigNumber(1,7)) 
      expect(getBigNumber(2,18).sub(pendingReward)).to.be.lt(10) 
    })
    it("SLP $1,000,000,000", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 1000000000
      let usd_per_lp = 360000
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
    })
    it("Balancer $100", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 100
      let usd_per_lp = 120
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
    })
    it("Balancer $1,000,000,000", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 1000000000
      let usd_per_lp = 120
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
    })
    it("1inch $100", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 100
      let usd_per_lp = 20
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
    })
    it("1inch $1,000,000,000", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 1000000000
      let usd_per_lp = 20
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      // 2 blocks between deposit and update for pool0 
      let accRewardTokensPerShare_decimals_0 = ACC_TOKEN_PRECISION - lps_decimals + 18 // 18 for reward token
      expect(pool0.accRewardTokensPerShare).to.be.equal(getBigNumber(2,accRewardTokensPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
    })
    it("1inch $1,000,000,000, accRewardTokensPerShare > 0", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 1000000000
      let usd_per_lp = 20
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      expect(Number(pool0.accRewardTokensPerShare)).to.be.greaterThan(0)
    })
  })

  describe("Withdraw", function () {
    it("Should emit event Withdraw", async function () {
      await this.farm.add(10, this.lps.address)
      await expect(this.farm.withdraw(0, getBigNumber(0), this.alice.address))
            .to.emit(this.farm, "Withdraw")
            .withArgs(this.alice.address, 0, 0, this.alice.address)
    })
    it("Partial withdraw should not affect pending rewards (with one user)", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      await time.advanceBlock()
      let pendingReward = await this.farm.pendingReward(0, this.alice.address)

      let l2 = await this.farm.withdraw(0, getBigNumber(1,3), this.alice.address)
      pendingReward = await this.farm.pendingReward(0, this.alice.address)
      let expectedReward = getBigNumber(1,18).mul(l2.blockNumber - l1.blockNumber)
      expect(pendingReward).to.be.equal(expectedReward)
    })
    it("Partial withdraw should not affect pending rewards (with two users)", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let al1 = await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      let bl1 = await this.farm.deposit(0, getBigNumber(2,3), this.bob.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()
      let pendingReward = await this.farm.pendingReward(0, this.alice.address)

      let al2 = await this.farm.withdraw(0, getBigNumber(1,3), this.alice.address)
      pendingReward = await this.farm.pendingReward(0, this.alice.address)
      let expectedReward = getBigNumber(1,18).mul(bl1.blockNumber - al1.blockNumber).add(getBigNumber(1,18).mul(al2.blockNumber - bl1.blockNumber).div(2))
      expect(pendingReward).to.be.equal(expectedReward)
    })
    it("Full withdraw leave pending rewards intact", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let al1 = await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      await time.advanceBlock()
      let al2 = await this.farm.withdraw(0, getBigNumber(2,3), this.alice.address)
      let pendingReward = await this.farm.pendingReward(0, this.alice.address)
      let expectedReward = getBigNumber(1,18).mul(al2.blockNumber - al1.blockNumber)
      expect(pendingReward).to.be.equal(expectedReward)
    })
    it("Full withdraw leave user with 0 balance", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      await time.advanceBlock()
      await this.farm.withdraw(0, getBigNumber(2,3), this.alice.address)
      let u2 = await this.farm.userInfo(0,this.alice.address)
      expect(u2.amount).to.be.equal(0)
    })
    it("Attempt to withdraws too much is aborted, balance remains the same", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      await time.advanceBlock()

      console.log("Will try to withdraw more than I have now...")
      const msg1 = 'BoringMath: Underflow';
      await expect(this.farm.withdraw(0, getBigNumber(3,3), this.alice.address)).to.be.revertedWith(msg1);

      let u = await this.farm.userInfo(0,this.alice.address)
      expect(u.amount).to.be.equal(2000)
    })
    it("Withdraw to another account", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(3,3), this.alice.address)
      // alice withdraws to bob's account
      await this.farm.withdraw(0, getBigNumber(2,3), this.bob.address)
      await time.advanceBlock()

      let u1 = await this.lps.balanceOf(this.bob.address)
      expect(u1).to.be.equal(getBigNumber(2,3))
    })
  })

  describe("Harvest", function () {
    it("Should give back the correct amount of rewards", async function () {
        const [alice, bob, carol, dev] = await ethers.getSigners();

        await this.farm.add(10, this.lps.address)
        await this.lps.approve(this.farm.address, getBigNumber(10))

        let l1 = await this.farm.deposit(0, getBigNumber(1), this.bob.address)
        await time.advanceBlockTo(l1.blockNumber + 3) // advance 3 blocks ahead
        let l2 = await this.farm.updatePool(0)

        let expectedReward = getBigNumber(1,18).mul(l2.blockNumber + 1 - l1.blockNumber)
        
        await this.farm.connect(bob).harvest(0, this.bob.address)
        expect((await this.farm.userInfo(0, this.bob.address)).rewardDebt).to.be.equal(expectedReward)
        expect(await this.token.balanceOf(this.bob.address)).to.be.equal(expectedReward)
    })
    it("Send your harvest to another account", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))

      let l1 = await this.farm.deposit(0, getBigNumber(1), this.bob.address)
      await time.advanceBlockTo(l1.blockNumber + 3) // advance 3 blocks ahead
      let l2 = await this.farm.updatePool(0)

      let expectedReward = getBigNumber(1,18).mul(l2.blockNumber + 1 - l1.blockNumber)
      
      await this.farm.connect(bob).harvest(0, this.carol.address)
      expect((await this.farm.userInfo(0, this.bob.address)).rewardDebt).to.be.equal(expectedReward)
      expect(await this.token.balanceOf(this.bob.address)).to.be.equal(0)
      expect(await this.token.balanceOf(this.carol.address)).to.be.equal(expectedReward)
  })
  it("Harvest with empty user balance", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      await this.farm.add(10, this.lps.address)
      await this.farm.connect(bob).harvest(0, this.bob.address)
      expect(await this.token.balanceOf(this.bob.address)).to.be.equal(0)
    })
  })

  describe("EmergencyWithdraw", function() {
    it("Should emit event EmergencyWithdraw", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1), this.bob.address)
      await expect(this.farm.connect(this.bob).emergencyWithdraw(0, this.bob.address))
      .to.emit(this.farm, "EmergencyWithdraw")
      .withArgs(this.bob.address, 0, getBigNumber(1), this.bob.address)
    })
    it("Balance or LP and pendingReward are correct after EmergencyWithdraw", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1), this.bob.address)
      await time.advanceBlock()

      await this.farm.connect(this.bob).emergencyWithdraw(0, this.bob.address)

      expect(await this.farm.pendingReward(0, this.bob.address)).to.be.equal(0)
      expect(await this.lps.balanceOf(this.bob.address)).to.be.equal(getBigNumber(1))
    })
    it("Cannot withdraw to zero address", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1), this.bob.address)
      await time.advanceBlock()

      const msg1 = "genericFarmV2::can't withdraw to address zero";

      await expect(this.farm.connect(this.bob).emergencyWithdraw(0, ADDRESS_ZERO)).to.be.revertedWith(msg1);
    })
  })
})
