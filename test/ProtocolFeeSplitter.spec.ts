import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { UniswapV3Factory } from '../typechain/UniswapV3Factory'
import { UniswapV3PoolDeployer } from '../typechain/UniswapV3PoolDeployer'
import { ProtocolFeeSplitter } from '../typechain/ProtocolFeeSplitter'
import { TestUniswapV3Callee } from '../typechain/TestUniswapV3Callee'
import { MockTimeUniswapV3Pool } from '../typechain/MockTimeUniswapV3Pool'

import { TestERC20 } from '../typechain/TestERC20'

import { expect } from './shared/expect'
import snapshotGasCost from './shared/snapshotGasCost'
import { poolFixture } from './shared/fixtures'
import {
  expandTo18Decimals,
  FeeAmount,
  getPositionKey,
  getMaxTick,
  getMinTick,
  encodePriceSqrt,
  TICK_SPACINGS,
  createPoolFunctions,
  SwapFunction,
  MintFunction
} from './shared/utilities'

const { constants } = ethers

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000',
]
let swapTarget: TestUniswapV3Callee

const createFixtureLoader = waffle.createFixtureLoader
type ThenArg<T> = T extends PromiseLike<infer U> ? U : T
let createPool: ThenArg<ReturnType<typeof poolFixture>>['createPool']

describe('ProtocolFeeSplitter', () => {
  let wallet: Wallet, other: Wallet, other2: Wallet

  let factory: UniswapV3Factory
  let poolDeployer: UniswapV3PoolDeployer
  let protocolFeeSplitter: ProtocolFeeSplitter
  let poolBytecode: string

  const fixture = async () => {
    let ProtocolFeeSplitter = await ethers.getContractFactory('ProtocolFeeSplitter');
    protocolFeeSplitter = await ProtocolFeeSplitter.deploy(other.address, other2.address) as ProtocolFeeSplitter;

    let UniswapV3PoolDeployer = await ethers.getContractFactory('UniswapV3PoolDeployer');
    poolDeployer = await UniswapV3PoolDeployer.deploy() as UniswapV3PoolDeployer;

    const factoryFactory = await ethers.getContractFactory('UniswapV3Factory')
    return (await factoryFactory.deploy(poolDeployer.address, protocolFeeSplitter.address)) as UniswapV3Factory
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

    // await protocolFeeSplitter.setFactoryAddress(factory.address)
    await poolDeployer.setFactoryAddress(factory.address)
  })

  it('should set arbidexAddress', async () => {
    expect(await protocolFeeSplitter.arbidexAddress()).to.eq(other.address)
  })

  it('should set managementAddress', async () => {
    expect(await protocolFeeSplitter.managementAddress()).to.eq(other2.address)
  })

  describe('#setFactoryAddress', () => {
    it('fails if already initailized', async () => {
      await protocolFeeSplitter.setFactoryAddress(other.address);
      await expect(protocolFeeSplitter.setFactoryAddress(wallet.address)).to.be.revertedWith("already initialized")
    })

    it('set factory contract address', async () => {
      expect(await protocolFeeSplitter.factoryAddress()).to.eq(ethers.constants.AddressZero)
      await protocolFeeSplitter.setFactoryAddress(factory.address)
      expect(await protocolFeeSplitter.factoryAddress()).to.eq(factory.address)
      await expect(protocolFeeSplitter.setFactoryAddress(wallet.address)).to.be.revertedWith("already initialized")
    })

    it('emits event', async () => {
      await expect(protocolFeeSplitter.setFactoryAddress(factory.address))
        .to.emit(protocolFeeSplitter, 'SetFactoryAddress')
        .withArgs(factory.address)
    })
  })

  describe('#changeArbiDexAddress', () => {
    it('fails if caller is not arbidexAddress', async () => {
      await expect(protocolFeeSplitter.connect(other2).changeArbiDexAddress(wallet.address)).to.be.reverted
    })

    it('updates arbidexAddress', async () => {
      await protocolFeeSplitter.connect(other).changeArbiDexAddress(wallet.address)
      expect(await protocolFeeSplitter.arbidexAddress()).to.eq(wallet.address)
    })

    it('cannot be called by original owner', async () => {
      await expect(protocolFeeSplitter.connect(wallet).changeArbiDexAddress(wallet.address)).to.be.reverted
    })
  })

  describe('#changeManagementAddress', () => {
    it('fails if caller is not managementAddress', async () => {
      await expect(protocolFeeSplitter.connect(other).changeManagementAddress(wallet.address)).to.be.reverted
    })

    it('updates managementAddress', async () => {
      await protocolFeeSplitter.connect(other2).changeManagementAddress(wallet.address)
      expect(await protocolFeeSplitter.managementAddress()).to.eq(wallet.address)
    })

    it('cannot be called by original owner', async () => {
      await expect(protocolFeeSplitter.connect(wallet).changeManagementAddress(wallet.address)).to.be.reverted
    })
  })

  describe('#collectFees & distributeFees', () => {

    let token0: TestERC20
    let token1: TestERC20
    let token2: TestERC20
  
    let swapExact0For1: SwapFunction
    let swap0ForExact1: SwapFunction
    let swapExact1For0: SwapFunction
    let swap1ForExact0: SwapFunction
    let mint: MintFunction
    let pool: MockTimeUniswapV3Pool
    let protocolFeeSplitter: ProtocolFeeSplitter
  
    let feeAmount: number
    let tickSpacing: number
  
    let minTick: number
    let maxTick: number

    beforeEach('deploy fixture', async () => {
      ;({ token0, token1, token2, factory, createPool, swapTargetCallee: swapTarget, protocolFeeSplitter } = await loadFixture(poolFixture))
  
      const oldCreatePool = createPool
      createPool = async (_feeAmount, _tickSpacing) => {
        const pool = await oldCreatePool(_feeAmount, _tickSpacing)
        ;({
          swapExact0For1,
          swap0ForExact1,
          swapExact1For0,
          swap1ForExact0,
          mint,
        } = createPoolFunctions({
          token0,
          token1,
          swapTarget,
          pool,
        }))
        minTick = getMinTick(_tickSpacing)
        maxTick = getMaxTick(_tickSpacing)
        feeAmount = _feeAmount
        tickSpacing = _tickSpacing
        return pool
      }
  
      // default to the 30 bips pool
      pool = await createPool(FeeAmount.MEDIUM, TICK_SPACINGS[FeeAmount.MEDIUM])

      // initialize the pool at price of 10:1
      await pool.initialize(encodePriceSqrt(1, 10))

      await mint(wallet.address, minTick, maxTick, 3161)
    })

    it('collect & distribute fees for one pool as expected', async () => {
      await mint(wallet.address, minTick + tickSpacing, maxTick - tickSpacing, expandTo18Decimals(1))
      await swapExact0For1(expandTo18Decimals(1).div(10), wallet.address)
      await swapExact1For0(expandTo18Decimals(1).div(100), wallet.address)

      let { token0: token0ProtocolFees, token1: token1ProtocolFees } = await pool.protocolFees()
      expect(token0ProtocolFees).to.eq('300000000000000');
      expect(token1ProtocolFees).to.eq('30000000000000');

      expect(await token0.balanceOf(protocolFeeSplitter.address)).to.eq(0)
      expect(await token1.balanceOf(protocolFeeSplitter.address)).to.eq(0)

      await expect(protocolFeeSplitter.collectFees([pool.address]))
        .to.emit(pool, "CollectProtocol")
        .withArgs(factory.address, protocolFeeSplitter.address, "299999999999999", "29999999999999");

      expect(await token0.balanceOf(protocolFeeSplitter.address)).to.eq("299999999999999")
      expect(await token1.balanceOf(protocolFeeSplitter.address)).to.eq("29999999999999")

      let arbidexAddress = await protocolFeeSplitter.arbidexAddress();
      let managementAddress = await protocolFeeSplitter.managementAddress();

      await expect(protocolFeeSplitter.distributeFees([token0.address, token1.address]))
        .to.emit(token0, "Transfer")
        .withArgs(protocolFeeSplitter.address, arbidexAddress, "270000000000000")

        .to.emit(token0, "Transfer")
        .withArgs(protocolFeeSplitter.address, managementAddress, "29999999999999")

        .to.emit(token1, "Transfer")
        .withArgs(protocolFeeSplitter.address, arbidexAddress, "27000000000000")

        .to.emit(token1, "Transfer")
        .withArgs(protocolFeeSplitter.address, managementAddress, "2999999999999")
    })
  })
})
