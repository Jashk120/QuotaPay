// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./interfaces/IDaoModules.sol";

/// Allowlisted treasury assets (mock RWA / NFT) and the demo marketplace.
///
/// `DaoCore` is the only caller. That makes the module a thin custody and
/// pricing layer: the tier-1/tier-2/tier-3 decision stays in `DaoCore`, and the
/// module only enforces the per-asset cap and the holdings ledger.
contract AssetModule {
    struct Asset {
        address token;
        uint256 unitPrice;
        uint256 cap;
        bool allowed;
    }

    address public immutable dao;

    mapping(bytes32 => Asset) public assets;
    mapping(address => mapping(bytes32 => uint256)) public holdings;

    event AssetAllowed(
        bytes32 indexed assetId,
        address indexed token,
        uint256 unitPrice,
        uint256 cap
    );
    event AssetCapSet(bytes32 indexed assetId, uint256 cap);
    event Acquired(bytes32 indexed assetId, uint256 amount, uint256 cost);
    event Disposed(bytes32 indexed assetId, uint256 amount, address indexed to);

    modifier onlyDao() {
        require(msg.sender == dao, "not dao");
        _;
    }

    constructor(address dao_) {
        require(dao_ != address(0), "dao=0");
        dao = dao_;
    }

    // ------------------------------------------------------------ registry --

    function allowAsset(
        bytes32 assetId,
        address token,
        uint256 unitPrice,
        uint256 cap
    ) external onlyDao {
        require(assetId != bytes32(0), "assetId=0");
        require(token != address(0), "token=0");
        require(unitPrice > 0, "price=0");
        require(cap > 0, "cap=0");
        // Re-allowlisting would change the token or price under existing
        // holdings, so an asset id is immutable once created.
        require(assets[assetId].token == address(0), "asset exists");
        assets[assetId] = Asset({
            token: token,
            unitPrice: unitPrice,
            cap: cap,
            allowed: true
        });
        emit AssetAllowed(assetId, token, unitPrice, cap);
    }

    function setAssetCap(bytes32 assetId, uint256 cap) external onlyDao {
        Asset storage asset = assets[assetId];
        require(asset.allowed, "unknown asset");
        require(cap > 0, "cap=0");
        asset.cap = cap;
        emit AssetCapSet(assetId, cap);
    }

    function assetInfo(bytes32 assetId)
        external
        view
        returns (address token, uint256 unitPrice, uint256 cap)
    {
        Asset storage asset = assets[assetId];
        return (asset.token, asset.unitPrice, asset.cap);
    }

    // ----------------------------------------------------------- acquisition --

    /// Tier-1 acquisition. `cap` bounds the total position (existing holdings
    /// plus this purchase), not just the single transaction, so repeated buys
    /// cannot walk the treasury past the cap.
    function buy(bytes32 assetId, uint256 amount) external onlyDao {
        Asset storage asset = assets[assetId];
        require(asset.allowed, "unknown asset");
        uint256 cost = _cost(asset, amount);
        require(
            (holdings[dao][assetId] + amount) * asset.unitPrice <= asset.cap,
            "asset cap"
        );
        _pull(assetId, asset, amount, cost);
    }

    /// Tier-3 acquisition, reached only through `DaoCore.executeProposal`.
    function buyAboveCap(bytes32 assetId, uint256 amount) external onlyDao {
        Asset storage asset = assets[assetId];
        require(asset.allowed, "unknown asset");
        _pull(assetId, asset, amount, _cost(asset, amount));
    }

    function _cost(Asset storage asset, uint256 amount) private view returns (uint256) {
        require(amount > 0, "amount=0");
        return amount * asset.unitPrice;
    }

    function _pull(
        bytes32 assetId,
        Asset storage asset,
        uint256 amount,
        uint256 cost
    ) private {
        holdings[dao][assetId] += amount;
        require(
            IERC20(asset.token).transferFrom(dao, address(this), cost),
            "transfer failed"
        );
        emit Acquired(assetId, amount, cost);
    }

    // --------------------------------------------------------------- disposal --

    /// Tier-2 disposal, reached only through `DaoCore.disposeAsset` after the
    /// admin signature is checked. The unit price is fixed per asset, so the
    /// holder receives the same value that acquisition paid in.
    function dispose(bytes32 assetId, uint256 amount, address to) external onlyDao {
        Asset storage asset = assets[assetId];
        require(asset.allowed, "unknown asset");
        require(to != address(0), "to=0");
        require(amount > 0, "amount=0");
        require(holdings[dao][assetId] >= amount, "holdings");
        holdings[dao][assetId] -= amount;
        require(
            IERC20(asset.token).transfer(to, amount * asset.unitPrice),
            "transfer failed"
        );
        emit Disposed(assetId, amount, to);
    }
}
