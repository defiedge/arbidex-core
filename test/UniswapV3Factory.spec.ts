import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { UniswapV3Factory } from '../typechain/UniswapV3Factory'
import { UniswapV3PoolDeployer } from '../typechain/UniswapV3PoolDeployer'
import { ProtocolFeeSplitter } from '../typechain/ProtocolFeeSplitter'
import { expect } from './shared/expect'
import snapshotGasCost from './shared/snapshotGasCost'

import { FeeAmount, getCreate2Address, MAX_SQRT_RATIO, MaxUint128, TICK_SPACINGS, encodePriceSqrt } from './shared/utilities'

const { constants } = ethers

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000',
]

const createFixtureLoader = waffle.createFixtureLoader

describe('UniswapV3Factory', () => {
  let wallet: Wallet, other: Wallet, other2: Wallet

  let factory: UniswapV3Factory
  let poolDeployer: UniswapV3PoolDeployer
  let arbidexFeeSplitter: ProtocolFeeSplitter
  let poolBytecode: string

  const fixture = async () => {
    let ProtocolFeeSplitter = await ethers.getContractFactory('ProtocolFeeSplitter');
    arbidexFeeSplitter = await ProtocolFeeSplitter.deploy(other.address, other2.address) as ProtocolFeeSplitter;

    let UniswapV3PoolDeployer = await ethers.getContractFactory('UniswapV3PoolDeployer');
    poolDeployer = await UniswapV3PoolDeployer.deploy() as UniswapV3PoolDeployer;

    const factoryFactory = await ethers.getContractFactory('UniswapV3Factory')
    return (await factoryFactory.deploy(poolDeployer.address, arbidexFeeSplitter.address)) as UniswapV3Factory
  }

  let loadFixture: ReturnType<typeof createFixtureLoader>
  before('create fixture loader', async () => {
    ;[wallet, other, other2] = await (ethers as any).getSigners()

    loadFixture = createFixtureLoader([wallet, other])
  })

  before('load pool bytecode', async () => {
    poolBytecode = (await ethers.getContractFactory('UniswapV3Pool')).bytecode
  })

  beforeEach('deploy factory', async () => {
    factory = await loadFixture(fixture)

    await arbidexFeeSplitter.setFactoryAddress(factory.address)
    await poolDeployer.setFactoryAddress(factory.address)
  })

  it('owner is deployer', async () => {
    expect(await factory.owner()).to.eq(wallet.address)
  })

  it('should set pool deployer address', async () => {
    expect(await factory.poolDeployer()).to.eq(poolDeployer.address)
  })

  it('should set fee splitter address address', async () => {
    expect(await factory.PROTOCOL_FEES_RECIPIENT()).to.eq(arbidexFeeSplitter.address)
  })

  it('factory bytecode size', async () => {
    expect(((await waffle.provider.getCode(factory.address)).length - 2) / 2).to.matchSnapshot()
  })

  it('pool bytecode size', async () => {
    await factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], FeeAmount.MEDIUM)
    const poolAddress = getCreate2Address(poolDeployer.address, TEST_ADDRESSES, FeeAmount.MEDIUM, poolBytecode)
    expect(((await waffle.provider.getCode(poolAddress)).length - 2) / 2).to.matchSnapshot()
  })

  it('initial enabled fee amounts', async () => {
    expect(await factory.feeAmountTickSpacing(FeeAmount.LOW)).to.eq(TICK_SPACINGS[FeeAmount.LOW])
    expect(await factory.feeAmountTickSpacing(FeeAmount.MEDIUM)).to.eq(TICK_SPACINGS[FeeAmount.MEDIUM])
    expect(await factory.feeAmountTickSpacing(FeeAmount.HIGH)).to.eq(TICK_SPACINGS[FeeAmount.HIGH])
  })


  async function createAndCheckPool(
    tokens: [string, string],
    feeAmount: FeeAmount,
    tickSpacing: number = TICK_SPACINGS[feeAmount]
  ) {
    const create2Address = getCreate2Address(poolDeployer.address, tokens, feeAmount, poolBytecode)
    const create = factory.createPool(tokens[0], tokens[1], feeAmount)

    await expect(create)
      .to.emit(factory, 'PoolCreated')
      .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], feeAmount, tickSpacing, create2Address)

    await expect(factory.createPool(tokens[0], tokens[1], feeAmount)).to.be.reverted
    await expect(factory.createPool(tokens[1], tokens[0], feeAmount)).to.be.reverted
    expect(await factory.getPool(tokens[0], tokens[1], feeAmount), 'getPool in order').to.eq(create2Address)
    expect(await factory.getPool(tokens[1], tokens[0], feeAmount), 'getPool in reverse').to.eq(create2Address)

    const poolContractFactory = await ethers.getContractFactory('UniswapV3Pool')
    const pool = poolContractFactory.attach(create2Address)
    expect(await pool.factory(), 'pool factory address').to.eq(factory.address)
    expect(await pool.token0(), 'pool token0').to.eq(TEST_ADDRESSES[0])
    expect(await pool.token1(), 'pool token1').to.eq(TEST_ADDRESSES[1])
    expect(await pool.fee(), 'pool fee').to.eq(feeAmount)
    expect(await pool.tickSpacing(), 'pool tick spacing').to.eq(tickSpacing)
  }

  describe('#createPool', () => {
    it('succeeds for low fee pool', async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.LOW)
    })

    it('succeeds for medium fee pool', async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.MEDIUM)
    })
    it('succeeds for high fee pool', async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.HIGH)
    })

    it('succeeds if tokens are passed in reverse', async () => {
      await createAndCheckPool([TEST_ADDRESSES[1], TEST_ADDRESSES[0]], FeeAmount.MEDIUM)
    })

    it('fails if token a == token b', async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[0], FeeAmount.LOW)).to.be.reverted
    })

    it('fails if token a is 0 or token b is 0', async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], constants.AddressZero, FeeAmount.LOW)).to.be.reverted
      await expect(factory.createPool(constants.AddressZero, TEST_ADDRESSES[0], FeeAmount.LOW)).to.be.reverted
      await expect(factory.createPool(constants.AddressZero, constants.AddressZero, FeeAmount.LOW)).to.be.revertedWith(
        ''
      )
    })

    it('fails if fee amount is not enabled', async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], 250)).to.be.reverted
    })

    it('gas', async () => {
      await snapshotGasCost(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], FeeAmount.MEDIUM))
    })
  })

  describe('#setOwner', () => {
    it('fails if caller is not owner', async () => {
      await expect(factory.connect(other).setOwner(wallet.address)).to.be.reverted
    })

    it('updates owner', async () => {
      await factory.setOwner(other.address)
      expect(await factory.owner()).to.eq(other.address)
    })

    it('emits event', async () => {
      await expect(factory.setOwner(other.address))
        .to.emit(factory, 'OwnerChanged')
        .withArgs(wallet.address, other.address)
    })

    it('cannot be called by original owner', async () => {
      await factory.setOwner(other.address)
      await expect(factory.setOwner(wallet.address)).to.be.reverted
    })
  })

  describe('#enableFeeAmount', () => {
    it('fails if caller is not owner', async () => {
      await expect(factory.connect(other).enableFeeAmount(100, 2)).to.be.reverted
    })
    it('fails if fee is too great', async () => {
      await expect(factory.enableFeeAmount(1000000, 10)).to.be.reverted
    })
    it('fails if tick spacing is too small', async () => {
      await expect(factory.enableFeeAmount(500, 0)).to.be.reverted
    })
    it('fails if tick spacing is too large', async () => {
      await expect(factory.enableFeeAmount(500, 16834)).to.be.reverted
    })
    it('fails if already initialized', async () => {
      await factory.enableFeeAmount(100, 5)
      await expect(factory.enableFeeAmount(100, 10)).to.be.reverted
    })
    it('sets the fee amount in the mapping', async () => {
      await factory.enableFeeAmount(100, 5)
      expect(await factory.feeAmountTickSpacing(100)).to.eq(5)
    })
    it('emits an event', async () => {
      await expect(factory.enableFeeAmount(100, 5)).to.emit(factory, 'FeeAmountEnabled').withArgs(100, 5)
    })
    it('enables pool creation', async () => {
      await factory.enableFeeAmount(250, 15)
      await createAndCheckPool([TEST_ADDRESSES[0], TEST_ADDRESSES[1]], 250, 15)
    })
  })

  describe('#setDefaultProtocolFees', () => {
    it('fails if caller is not owner', async () => {
      await expect(factory.connect(other).setDefaultProtocolFees(100, 2)).to.be.revertedWith("Not owner")
    })
    it('fails if fee greater then 10', async () => {
      await expect(factory.setDefaultProtocolFees(8, 11)).to.be.revertedWith("Invalid Fees")
      await expect(factory.setDefaultProtocolFees(11, 8)).to.be.revertedWith("Invalid Fees")
      await expect(factory.setDefaultProtocolFees(11, 14)).to.be.revertedWith("Invalid Fees")
    })
    it('should set default protocol fees', async () => {
      expect(await factory.defaultProtocolFees()).to.eq(17)

      await factory.setDefaultProtocolFees(7, 7);
      expect(await factory.defaultProtocolFees()).to.eq(119)

      await factory.setDefaultProtocolFees(5, 8);
      expect(await factory.defaultProtocolFees()).to.eq(133)

      await factory.setDefaultProtocolFees(0, 0);
      expect(await factory.defaultProtocolFees()).to.eq(0)
    })
    it('emits an event when turned on', async () => {
      await expect(factory.setDefaultProtocolFees(7, 7)).to.be.emit(factory, 'DefaultProtocolFeesChanged').withArgs(1, 1, 7, 7)
    })
    it('emits an event when turned off', async () => {
      await factory.setDefaultProtocolFees(7, 5)
      await expect(factory.setDefaultProtocolFees(0, 0)).to.be.emit(factory, 'DefaultProtocolFeesChanged').withArgs(7, 5, 0, 0)
    })
    it('emits an event when changed', async () => {
      await factory.setDefaultProtocolFees(4, 10)
      await expect(factory.setDefaultProtocolFees(6, 8)).to.be.emit(factory, 'DefaultProtocolFeesChanged').withArgs(4, 10, 6, 8)
    })
    it('emits an event when unchanged', async () => {
      await factory.setDefaultProtocolFees(5, 9)
      await expect(factory.setDefaultProtocolFees(5, 9)).to.be.emit(factory, 'DefaultProtocolFeesChanged').withArgs(5, 9, 5, 9)
    })
  })

  describe('#collectProtocolFees', () => {
    it('fails if caller is not owner', async () => {
      await expect(factory.connect(other).collectProtocolFees(wallet.address, MaxUint128, MaxUint128)).to.be.reverted;
    })
    it('not fails if caller is owner', async () => {
      await factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], FeeAmount.MEDIUM);
      let pool = await factory.getPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], FeeAmount.MEDIUM)
      let poolInstance = await ethers.getContractAt("UniswapV3Pool", pool)
      await poolInstance.initialize(encodePriceSqrt(1, 1))

      await expect(factory.collectProtocolFees(pool, MaxUint128, MaxUint128)).to.be.not.reverted;
    })
    it('fails if caller is not owner', async () => {
      await expect(factory.connect(other).collectProtocolFees(wallet.address, MaxUint128, MaxUint128)).to.be.reverted;
    })
  })
})
