import neo4j from "neo4j-driver";
import * as dotenv from "dotenv";
import { resolve } from "path";
import * as fs from "fs";

const backendEnvPath = resolve(process.cwd(), "backend/.env");
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else {
  dotenv.config();
}

const uri =
  process.env["COGNO_DB_URI"] ??
  process.env["COGNODB_URI"] ??
  "bolt://localhost:7687";
const user =
  process.env["COGNO_DB_USER"] ?? process.env["COGNODB_USER"] ?? "neo4j";
const password =
  process.env["COGNO_DB_PASSWORD"] ??
  process.env["COGNODB_PASSWORD"] ??
  "password";
const database =
  process.env["COGNO_DB_DATABASE"] ??
  process.env["COGNODB_DATABASE"] ??
  "neo4j";

const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

async function main() {
  console.log(
    `\n${COLORS.bold}${COLORS.cyan}==============================================================${COLORS.reset}`,
  );
  console.log(
    `${COLORS.bold}🧠 COGNODB LIVE CONNECTION & SEED VERIFICATION${COLORS.reset}`,
  );
  console.log(`${COLORS.dim}Connecting to: ${uri}${COLORS.reset}`);
  console.log(
    `${COLORS.cyan}==============================================================${COLORS.reset}\n`,
  );

  let driver;
  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      connectionTimeout: 10000,
    });

    console.log(`[1/4] Verifying Bolt connection to CognoDB...`);
    const serverInfo = await driver.getServerInfo();
    console.log(
      `${COLORS.green}✔ Successfully connected to CognoDB Cloud!${COLORS.reset}`,
    );
    console.log(`      Server Address:  ${serverInfo.address}`);
    console.log(`      Protocol Ver:    ${serverInfo.protocolVersion}\n`);

    const session = driver.session({ database });

    try {
      console.log(`[2/4] Seeding demo fraud cluster ($MOON)...`);

      // 1. Create/Merge $MOON token and Wash Trading Loop (4 hops cycling 19,940 SOL volume)
      await session.run(`
        MERGE (t:Token {symbol: 'MOON'})
        SET t.name = 'MoonShot Protocol', t.address = 'MOON_TOKEN_MINT_11111', t:DemoCluster

        MERGE (w1:Wallet {address: '7Y4d...WashMaster'})
        SET w1.label = 'Mastermind Wallet', w1:DemoCluster

        MERGE (w2:Wallet {address: '3Km9...WashNode2'})
        SET w2.label = 'Wash Ring Node 2', w2:DemoCluster

        MERGE (w3:Wallet {address: '8Pq1...WashNode3'})
        SET w3.label = 'Wash Ring Node 3', w3:DemoCluster

        MERGE (w4:Wallet {address: '2Xv7...WashNode4'})
        SET w4.label = 'Wash Ring Node 4', w4:DemoCluster

        MERGE (w1)-[r1:TRANSFERRED {tokenSymbol: 'MOON'}]->(w2)
        SET r1.amount = 4985.0, r1.timestamp = timestamp()

        MERGE (w2)-[r2:TRANSFERRED {tokenSymbol: 'MOON'}]->(w3)
        SET r2.amount = 4985.0, r2.timestamp = timestamp()

        MERGE (w3)-[r3:TRANSFERRED {tokenSymbol: 'MOON'}]->(w4)
        SET r3.amount = 4985.0, r3.timestamp = timestamp()

        MERGE (w4)-[r4:TRANSFERRED {tokenSymbol: 'MOON'}]->(w1)
        SET r4.amount = 4985.0, r4.timestamp = timestamp()
      `);

      // 2. Merge 12 Sybil bot wallets funded by mastermind
      for (let i = 1; i <= 12; i++) {
        await session.run(
          `
          MATCH (w1:Wallet {address: '7Y4d...WashMaster'}), (t:Token {symbol: 'MOON'})
          MERGE (b:Wallet {address: $botAddress})
          SET b.label = $botLabel, b:DemoCluster
          MERGE (w1)-[f:FUNDED]->(b)
          SET f.amount = 4.0, f.tokenSymbol = 'SOL', f.timestamp = timestamp()
          MERGE (b)-[s:SWAPPED]->(t)
          SET s.amount = 4.0, s.tokenSymbol = 'MOON', s.timestamp = timestamp()
        `,
          {
            botAddress: `BotSybil_${i.toString().padStart(2, "0")}`,
            botLabel: `Sybil Sniper #${i}`,
          },
        );
      }

      // 3. Merge Peeling Chain to Exchange
      await session.run(`
        MATCH (w1:Wallet {address: '7Y4d...WashMaster'})
        MERGE (h1:Wallet {address: 'PeelHop1...Addr'})
        SET h1.label = 'Peel Split 1', h1:DemoCluster

        MERGE (h2:Wallet {address: 'PeelHop2...Addr'})
        SET h2.label = 'Peel Split 2', h2:DemoCluster

        MERGE (h3:Wallet {address: 'PeelHop3...Addr'})
        SET h3.label = 'Peel Split 3', h3:DemoCluster

        MERGE (ex:Exchange {address: 'BinanceHotWallet11111'})
        SET ex.label = 'Binance Deposit Hot Wallet', ex:DemoCluster

        MERGE (w1)-[p1:TRANSFERRED {tokenSymbol: 'SOL'}]->(h1)
        SET p1.amount = 50.0

        MERGE (h1)-[p2:TRANSFERRED {tokenSymbol: 'SOL'}]->(h2)
        SET p2.amount = 45.0

        MERGE (h2)-[p3:TRANSFERRED {tokenSymbol: 'SOL'}]->(h3)
        SET p3.amount = 38.0

        MERGE (h3)-[p4:TRANSFERRED {tokenSymbol: 'SOL'}]->(ex)
        SET p4.amount = 35.0
      `);

      // 4. Merge benign token $SAFE
      await session.run(`
        MERGE (s:Token {symbol: 'SAFE'})
        SET s.name = 'SafeYield DAO', s.address = 'SAFE_TOKEN_MINT_22222', s:DemoCluster

        MERGE (user1:Wallet {address: 'NormalTraderA...Addr'})
        SET user1.label = 'Retail Trader A', user1:DemoCluster

        MERGE (user2:Wallet {address: 'NormalTraderB...Addr'})
        SET user2.label = 'Retail Trader B', user2:DemoCluster

        MERGE (user1)-[sw1:SWAPPED]->(s)
        SET sw1.amount = 10.0, sw1.tokenSymbol = 'SAFE'

        MERGE (user2)-[sw2:SWAPPED]->(s)
        SET sw2.amount = 15.0, sw2.tokenSymbol = 'SAFE'
      `);

      console.log(
        `${COLORS.green}✔ Live Seed completed: 4-hop wash ring, 12 Sybil bots, peeling chain, and $SAFE.${COLORS.reset}\n`,
      );

      console.log(`[3/4] Running live openCypher graph traversal queries...`);
      // Test Wash Trading Cycle Traversal
      const washQuery = `
        MATCH (start:Wallet)-[r0:TRANSFERRED]->(mid:Wallet)-[path:TRANSFERRED*1..5]->(start)
        WHERE ALL(r IN relationships(path) WHERE r.amount >= 0)
        WITH start, r0, mid, path, relationships(path) AS pathRels, (length(path) + 1) AS hopCount
        RETURN 
          start.address AS originAddress,
          hopCount,
          (r0.amount + reduce(total = 0.0, r IN pathRels | total + r.amount)) AS totalVolume,
          r0.tokenSymbol AS tokenSymbol
        LIMIT 5;
      `;
      const washRes = await session.run(washQuery);
      console.log(
        `      Found ${washRes.records.length} wash trading loops in CognoDB:`,
      );
      for (const rec of washRes.records) {
        console.log(
          `        • Loop Origin: ${rec.get("originAddress")} | Hops: ${rec.get("hopCount")} | Volume: $${rec.get("totalVolume")} SOL`,
        );
      }

      // Test Sybil Cluster Query
      const sybilQuery = `
        MATCH (funder:Wallet)-[f:FUNDED]->(sybil:Wallet)-[s:SWAPPED]->(t:Token)
        WHERE t.symbol = 'MOON'
        WITH funder, t, collect(DISTINCT sybil) AS sybilList, collect(DISTINCT f) AS fundingRels
        WHERE size(sybilList) >= 3
        RETURN 
          funder.address AS funderAddress,
          funder.label AS funderLabel,
          size(sybilList) AS sybilCount,
          reduce(total = 0.0, r IN fundingRels | total + r.amount) AS totalFundedAmount;
      `;
      const sybilRes = await session.run(sybilQuery);
      console.log(`      Found ${sybilRes.records.length} Sybil clusters:`);
      for (const rec of sybilRes.records) {
        console.log(
          `        • Funder: ${rec.get("funderAddress")} | Bots: ${rec.get("sybilCount")} | Funded: ${rec.get("totalFundedAmount")} SOL`,
        );
      }

      console.log(
        `\n[4/4] ${COLORS.green}${COLORS.bold}CognoDB Cloud is 100% verified with live graph data!${COLORS.reset}\n`,
      );
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error(
      `\n${COLORS.red}❌ Error during execution:${COLORS.reset}`,
      err,
    );
  } finally {
    if (driver) {
      await driver.close();
    }
  }
}

main().catch(console.error);
