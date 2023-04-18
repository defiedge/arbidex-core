// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;

import './libraries/TransferHelper.sol';
import './interfaces/IERC20Minimal.sol';

interface IUniswapFactory {
    function collectProtocolFees(address pool, uint128 amount0Requested, uint128 amount1Requested) external;
}

contract ProtocolFeeSplitter {
    address public factoryAddress; // uniswap factory contract address

    address public arbidexAddress; // will receive 90% from collected protocol fees
    address public managementAddress; // will receive 10% from collected protocol fees

    uint256 public constant BASE = 1e18; //100%
    uint256 public constant MANAGEMENT_PERCENTAGE = 100000000000000000; // 10%

    /// @notice Emitted when factory address is set
    event SetFactoryAddress(address indexed factory);

    constructor(address _arbidexAddress, address _managementAddress) {
        arbidexAddress = _arbidexAddress;
        managementAddress = _managementAddress;
    }

    function setFactoryAddress(address _factoryAddress) external {
        require(factoryAddress == address(0), "already initialized");

        factoryAddress = _factoryAddress;

        emit SetFactoryAddress(_factoryAddress);
    }

    /// @notice - collect fees from the multiple pool at once, all fees will be transferred to this contract
    /// @dev - make sure that _pools array is not too large
    function collectFees(address[] memory _pools) public {
        require(msg.sender == arbidexAddress || msg.sender == managementAddress, 'NA');
        _collectFees(_pools);
    }

    /// @notice - check available token balance in contract, split fees and transfer token to provided address
    /// @dev - make sure that _tokens array is not too large
    function distributeFees(address[] memory _tokens) public {
        require(msg.sender == arbidexAddress || msg.sender == managementAddress, 'NA');
        for (uint128 i = 0; i < _tokens.length; i++) {
            _distributeFees(_tokens[i]);
        }
    }

    /// @notice Updates the arbidexAddress
    /// @dev Must be called by the current arbidexAddress
    /// @param _arbidexAddress The new owner address to receive fees
    function changeArbiDexAddress(address _arbidexAddress) external {
        require(msg.sender == arbidexAddress);
        arbidexAddress = _arbidexAddress;
    }

    /// @notice Updates the managementAddress
    /// @dev Must be called by the current managementAddress
    /// @param _managementAddress The new owner address to receive fees
    function changeManagementAddress(address _managementAddress) external {
        require(msg.sender == managementAddress);
        managementAddress = _managementAddress;
    }

    function _collectFees(address[] memory _pools) internal {
        for (uint128 i = 0; i < _pools.length; i++) {
            IUniswapFactory(factoryAddress).collectProtocolFees(_pools[i], type(uint128).max, type(uint128).max);
        }
    }

    function _distributeFees(address _token) internal returns (uint256 _managementFees, uint256 _arbidexFees) {
        uint256 availableBalance = IERC20Minimal(_token).balanceOf(address(this));

        if (availableBalance > 10) {
            _managementFees = (MANAGEMENT_PERCENTAGE * availableBalance) / BASE;
            _arbidexFees = availableBalance - _managementFees;

            TransferHelper.safeTransfer(_token, managementAddress, _managementFees);
            TransferHelper.safeTransfer(_token, arbidexAddress, _arbidexFees);
        }
    }
}
