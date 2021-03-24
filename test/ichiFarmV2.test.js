const { expect, assert } = require("chai")
const { time, prepare, deploy, getBigNumber, ADDRESS_ZERO } = require("./utilities")

const ACC_ICHI_PRECISION = 18

// alice is a default Signer, so assume all calls are made by alice unless it's specified otherwise with "connect"

describe("ichiFarmV2", function () {
  before(async function () {
    await prepare(this, ['Ichi', 'ERC20Mock', 'ichiFarmV2'])
  })

  beforeEach(async function () {
    await deploy(this, [
      ["ichi", this.Ichi],
    ])

    // lp_small will represent LPs with low prices (aka UNI/Sushi/Bancor)
    // lp_large will represent LPs with high prices (aka 1inch/Balancer)
    await deploy(this, [
      ["lps", this.ERC20Mock, ["LP Small", "LPS", getBigNumber(10,64)]],
      ["lph", this.ERC20Mock, ["LP High", "LPH", getBigNumber(10,64)]]
    ])

    await deploy(this, [
        ['farm', this.ichiFarmV2, [this.ichi.address, getBigNumber(1,9)]] // reward = 1 ICHI per block 
    ])

    await this.ichi.transfer(this.farm.address, 1000000000000)
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

      try {
        await this.farm.connect(bob).add(10, this.lps.address)
      } catch (error) {
        console.log("Expected Error = "+ error)
      }
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
      pendingIchiForAlice = await this.farm.pendingIchi(0, this.alice.address)
      pendingIchiForBob = await this.farm.pendingIchi(1, this.bob.address)

      // expected ICHI = ichiPerBlock * [number of blocks] * allocPoints / totalAllocPoints
      let expectedIchiForAlice = getBigNumber(1,9).mul(l2.blockNumber - l1.blockNumber).mul(25).div(100)
      let expectedIchiForBob = getBigNumber(1,9).mul(l2.blockNumber - l1.blockNumber).mul(75).div(100)
      expect(pendingIchiForBob).to.be.equal(expectedIchiForBob)
      expect(pendingIchiForAlice).to.be.equal(expectedIchiForAlice)
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

      pendingIchiForAlice = await this.farm.pendingIchi(0, this.alice.address)
      pendingIchiForBob = await this.farm.pendingIchi(1, this.bob.address)

      // expected ICHI = ichiPerBlock * [number of blocks] * allocPoints / totalAllocPoints
      let expectedIchiForAlice = getBigNumber(1,9).mul(l2.blockNumber - l1.blockNumber).mul(1).div(3)
      let expectedIchiForBob = getBigNumber(1,9).mul(l2.blockNumber - l1.blockNumber).mul(2).div(3)
      expect(pendingIchiForBob).to.be.equal(expectedIchiForBob)
      expect(pendingIchiForAlice).to.be.equal(expectedIchiForAlice)
    })
  })

  describe("setIchiPerBlock", function() {
    it("Changing ichiPerBlock immediatelly affects rewards", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(1,3), this.alice.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()

      let l2 = await this.farm.setIchiPerBlock(getBigNumber(5,8), false) // halfing ichiPerBlock

      pendingIchiForAlice = await this.farm.pendingIchi(0, this.alice.address)

      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchiForAlice = getBigNumber(5,8).mul(l2.blockNumber - l1.blockNumber)
      expect(pendingIchiForAlice).to.be.equal(expectedIchiForAlice)
    })
    it("Changing ichiPerBlock only affects rewards after the last pool update", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(1,18), this.alice.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()
      //let pool0 = await this.farm.poolInfo(0);
      //console.log(pool0.allocPoint + ',' + pool0.accIchiPerShare + ',' + pool0.lastRewardBlock)
      //let pendingIchiForAlice = await this.farm.pendingIchi(0, this.alice.address)
      //console.log(Number(pendingIchiForAlice))

      let l2 = await this.farm.updatePool(0)
      let l3 = await this.farm.setIchiPerBlock(getBigNumber(5,8), true) // halfing ichiPerBlock

      let pendingIchiForAlice = await this.farm.pendingIchi(0, this.alice.address)

      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchiForAlice = getBigNumber(1,9).mul(l2.blockNumber - l1.blockNumber).
        add(getBigNumber(5,8).mul(l3.blockNumber - l2.blockNumber))
      expect(pendingIchiForAlice).to.be.equal(expectedIchiForAlice)
    })
  })

  describe("PendingIchi", function() {
    it("PendingIchi should equal ExpectedIchi", async function () {
      // create pool
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))

      // farm deposits LPs to the pool for Alice
      let log = await this.farm.deposit(0, getBigNumber(1), this.alice.address)
      await time.advanceBlock();
      let log2 = await this.farm.updatePool(0);
      
      await time.advanceBlock()
      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchi = getBigNumber(1,9).mul(log2.blockNumber + 1 - log.blockNumber)
      let pendingIchi = await this.farm.pendingIchi(0, this.alice.address)
      expect(pendingIchi).to.be.equal(expectedIchi)
    })
    it("When block is lastRewardBlock", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let l1 = await this.farm.deposit(0, getBigNumber(1), this.alice.address)
      await time.advanceBlockTo(l1.blockNumber + 3) // advance 3 blocks ahead
      let l2 = await this.farm.updatePool(0)
      let expectedIchi = getBigNumber(1,9).mul(l2.blockNumber - l1.blockNumber)
      let pendingIchi = await this.farm.pendingIchi(0, this.alice.address)
      expect(pendingIchi).to.be.equal(expectedIchi)
    })
  })

  describe("General pool's accIchiPerShare Calculatons", function () {
    it("with one pool", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let lp_decimals = 12
      await this.farm.deposit(0, getBigNumber(1,lp_decimals), this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool = await this.farm.poolInfo(0);
      let accIchiPerShare_decimals = ACC_ICHI_PRECISION - lp_decimals + 9 // 9 for ICHI
      expect(pool.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals))
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(3,accIchiPerShare_decimals_0).mul(10).div(20))
      let accIchiPerShare_decimals_1 = ACC_ICHI_PRECISION - lph_decimals + 9 // 9 for ICHI
      expect(pool1.accIchiPerShare).to.be.equal(getBigNumber(3,accIchiPerShare_decimals_1).mul(10).div(20))
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
      let accIchiPerShare_decimals = ACC_ICHI_PRECISION - lp_decimals + 9 // 9 for ICHI
      expect(pool.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals))
    })

    it("Updating invalid pools should fail", async function () {
      let err;
      try {
        await this.farm.massUpdatePools([0, 10000]) // pool 10000 doesn't exist
      } catch (e) {
        err = e;
      }

      assert.equal(err.toString(), "Error: VM Exception while processing transaction: invalid opcode")
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(3,accIchiPerShare_decimals_0).mul(10).div(20))
      let accIchiPerShare_decimals_1 = ACC_ICHI_PRECISION - lph_decimals + 9 // 9 for ICHI
      expect(pool1.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_1).mul(10).div(20))
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(3,accIchiPerShare_decimals_0).mul(10).div(20))
      let accIchiPerShare_decimals_1 = ACC_ICHI_PRECISION - lph_decimals + 9 // 9 for ICHI
      expect(pool1.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_1).mul(10).div(20))
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
  })

  
  describe("UpdatePool", function () {
    it("Should emit event LogUpdatePool", async function () {
      await this.farm.add(10, this.lps.address)
      await time.advanceBlock()
      await expect(this.farm.updatePool(0))
            .to.emit(this.farm, "LogUpdatePool")
            .withArgs(0, (await this.farm.poolInfo(0)).lastRewardBlock,
              (await this.lps.balanceOf(this.farm.address)),
              (await this.farm.poolInfo(0)).accIchiPerShare)
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

  describe("Deposit", function () {
    it("Should emit event Deposit", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await expect(this.farm.deposit(0, getBigNumber(1,3), this.alice.address))
            .to.emit(this.farm, "Deposit")
            .withArgs(this.alice.address, 0, 1000, this.alice.address)
    })
    it("Depositing into non-existent pool should fail", async function () {
      let err;
      try {
        await this.farm.deposit(1001, getBigNumber(0), this.alice.address)
      } catch (e) {
        err = e;
      }

      assert.equal(err.toString(), "Error: VM Exception while processing transaction: invalid opcode")
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

      pendingIchiForAlice = await this.farm.pendingIchi(0, this.alice.address)
      pendingIchiForBob = await this.farm.pendingIchi(0, this.bob.address)
      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchiForAlice = getBigNumber(1,9).mul(bl1.blockNumber - al1.blockNumber).
        add(getBigNumber(1,9).mul(bl2.blockNumber - bl1.blockNumber).div(2)).
        add(getBigNumber(1,9).mul(1).div(4))
      let expectedIchiForBob = getBigNumber(1,9).mul(bl2.blockNumber - bl1.blockNumber).div(2).
        add(getBigNumber(1,9).mul(3).div(4))
      expect(pendingIchiForBob).to.be.equal(expectedIchiForBob)
      expect(pendingIchiForAlice).to.be.equal(expectedIchiForAlice)
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

      pendingIchiForAlice = await this.farm.pendingIchi(0, this.alice.address)
      pendingIchiForBob = await this.farm.pendingIchi(0, this.bob.address)
      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchiForAlice = getBigNumber(1,9).mul(bl1.blockNumber - al1.blockNumber).
        add(getBigNumber(1,9).mul(al2.blockNumber - bl1.blockNumber).div(2)).
        add(getBigNumber(1,9).mul(bl2.blockNumber - al2.blockNumber).mul(1).div(3)).
        add(getBigNumber(1,9).mul(1).div(4))
      let expectedIchiForBob = getBigNumber(1,9).mul(al2.blockNumber - bl1.blockNumber).div(2).
        add(getBigNumber(1,9).mul(bl2.blockNumber - al2.blockNumber).mul(2).div(3)).
        add(getBigNumber(1,9).mul(3).div(4))
      expect(pendingIchiForBob).to.be.equal(expectedIchiForBob)
      expect(pendingIchiForAlice).to.be.equal(expectedIchiForAlice)
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

  describe("accIchiPerShare Calculations for various LPs", function () {
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_0).div(lps_value))
    })
    it("SLP $100", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(1,64))
      let lps_decimals = 18
      let num_usd = 100
      let usd_per_lp = 360000
      let lps_value = getBigNumber(num_usd,lps_decimals).div(usd_per_lp)

      await this.farm.deposit(0, lps_value, this.alice.address)
      await time.advanceBlock()
      await this.farm.updatePool(0)

      let pool0 = await this.farm.poolInfo(0);

      // 2 blocks between deposit and update for pool0 
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      let difference = getBigNumber(pool0.accIchiPerShare,0).sub(getBigNumber(2,accIchiPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
      if (ACC_ICHI_PRECISION == 20) {
        expect(Number(difference)).to.be.lessThan(10) // slightly less precise version if ACC_ICHI_PRECISION = 20 (not 18)
      } else {
        // for ACC_ICHI_PRECISION = 18
        expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
      }
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
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
      let accIchiPerShare_decimals_0 = ACC_ICHI_PRECISION - lps_decimals + 9 // 9 for ICHI
      expect(pool0.accIchiPerShare).to.be.equal(getBigNumber(2,accIchiPerShare_decimals_0).mul(usd_per_lp).div(num_usd))
    })
    it("1inch $1,000,000,000, accIchiPerShare > 0", async function () {
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

      expect(Number(pool0.accIchiPerShare)).to.be.greaterThan(0)
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
      let pendingIchi = await this.farm.pendingIchi(0, this.alice.address)

      let l2 = await this.farm.withdraw(0, getBigNumber(1,3), this.alice.address)
      pendingIchi = await this.farm.pendingIchi(0, this.alice.address)
      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchi = getBigNumber(1,9).mul(l2.blockNumber - l1.blockNumber)
      expect(pendingIchi).to.be.equal(expectedIchi)
    })
    it("Partial withdraw should not affect pending rewards (with two users)", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let al1 = await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      let bl1 = await this.farm.deposit(0, getBigNumber(2,3), this.bob.address)
      await time.advanceBlock()
      await time.advanceBlock()
      await time.advanceBlock()
      let pendingIchi = await this.farm.pendingIchi(0, this.alice.address)

      let al2 = await this.farm.withdraw(0, getBigNumber(1,3), this.alice.address)
      pendingIchi = await this.farm.pendingIchi(0, this.alice.address)
      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchi = getBigNumber(1,9).mul(bl1.blockNumber - al1.blockNumber).add(getBigNumber(1,9).mul(al2.blockNumber - bl1.blockNumber).div(2))
      expect(pendingIchi).to.be.equal(expectedIchi)
    })
    it("Full withdraw leave pending rewards intact", async function () {
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      let al1 = await this.farm.deposit(0, getBigNumber(2,3), this.alice.address)
      await time.advanceBlock()
      let al2 = await this.farm.withdraw(0, getBigNumber(2,3), this.alice.address)
      let pendingIchi = await this.farm.pendingIchi(0, this.alice.address)
      // expected ICHI = ichiPerBlock * [number of blocks]
      let expectedIchi = getBigNumber(1,9).mul(al2.blockNumber - al1.blockNumber)
      expect(pendingIchi).to.be.equal(expectedIchi)
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
      try {
        await this.farm.withdraw(0, getBigNumber(3,3), this.alice.address)
      } catch (error) {
        console.log("Expected Error = "+ error)
      }
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
    it("Should give back the correct amount of ICHI and reward", async function () {
        const [alice, bob, carol, dev] = await ethers.getSigners();

        await this.farm.add(10, this.lps.address)
        await this.lps.approve(this.farm.address, getBigNumber(10))

        let l1 = await this.farm.deposit(0, getBigNumber(1), this.bob.address)
        await time.advanceBlockTo(l1.blockNumber + 3) // advance 3 blocks ahead
        let l2 = await this.farm.updatePool(0)

        let expectedIchi = getBigNumber(1,9).mul(l2.blockNumber + 1 - l1.blockNumber)
        
        await this.farm.connect(bob).harvest(0, this.bob.address)
        expect((await this.farm.userInfo(0, this.bob.address)).rewardDebt).to.be.equal(expectedIchi)
        expect(await this.ichi.balanceOf(this.bob.address)).to.be.equal(expectedIchi)
    })
    it("Send your harvest to another account", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();
      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))

      let l1 = await this.farm.deposit(0, getBigNumber(1), this.bob.address)
      await time.advanceBlockTo(l1.blockNumber + 3) // advance 3 blocks ahead
      let l2 = await this.farm.updatePool(0)

      let expectedIchi = getBigNumber(1,9).mul(l2.blockNumber + 1 - l1.blockNumber)
      
      await this.farm.connect(bob).harvest(0, this.carol.address)
      expect((await this.farm.userInfo(0, this.bob.address)).rewardDebt).to.be.equal(expectedIchi)
      expect(await this.ichi.balanceOf(this.bob.address)).to.be.equal(0)
      expect(await this.ichi.balanceOf(this.carol.address)).to.be.equal(expectedIchi)
  })
  it("Harvest with empty user balance", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      await this.farm.add(10, this.lps.address)
      await this.farm.connect(bob).harvest(0, this.bob.address)
      expect(await this.ichi.balanceOf(this.bob.address)).to.be.equal(0)
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
    it("Balance or LP and pendingIchi are correct after EmergencyWithdraw", async function () {
      const [alice, bob, carol, dev] = await ethers.getSigners();

      await this.farm.add(10, this.lps.address)
      await this.lps.approve(this.farm.address, getBigNumber(10))
      await this.farm.deposit(0, getBigNumber(1), this.bob.address)
      await time.advanceBlock()

      await this.farm.connect(this.bob).emergencyWithdraw(0, this.bob.address)

      expect(await this.farm.pendingIchi(0, this.bob.address)).to.be.equal(0)
      expect(await this.lps.balanceOf(this.bob.address)).to.be.equal(getBigNumber(1))
    })
  })
})
