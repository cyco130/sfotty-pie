// Deletes every Cloudflare Pages *preview* deployment for a given branch.
// Run on PR close (see the deploy workflows) so merged/abandoned branches
// don't leave a pile of stale previews behind. Production is never touched.
//
// Relies only on Node built-ins + global `fetch`, so the workflow can run it
// without a `pnpm install`. Env: BRANCH_NAME, CLOUDFLARE_ACCOUNT_ID,
// CLOUDFLARE_API_TOKEN.
import process from "node:process";

const PROJECT_NAME = "a8-web";

const BRANCH_NAME = process.env.BRANCH_NAME;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!BRANCH_NAME) {
	throw new Error("Missing BRANCH_NAME");
}

if (BRANCH_NAME === "main") {
	throw new Error("Refusing to delete production deployments");
}

if (!CLOUDFLARE_ACCOUNT_ID) {
	throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
}

if (!CLOUDFLARE_API_TOKEN) {
	throw new Error("Missing CLOUDFLARE_API_TOKEN");
}

interface PagesDeployment {
	id: string;
	modified_on: string;
	deployment_trigger: { metadata: { branch: string } };
}

interface CfListResponse<T> {
	result: T[];
	result_info: { total_count: number };
}

await run();

async function run(): Promise<void> {
	const allDeployments = await getPreviewDeployments();

	const branchDeployments = allDeployments.filter(
		(deployment) =>
			deployment.deployment_trigger.metadata.branch === BRANCH_NAME,
	);

	if (!branchDeployments.length) {
		console.warn("No deployments found");
		return;
	}

	for (const deployment of branchDeployments) {
		console.log("Deleting deployment", deployment.id);
		await deletePagesDeployment(deployment.id);
	}
}

async function getPreviewDeployments(): Promise<PagesDeployment[]> {
	console.log("Fetching preview deployments");
	const deployments: PagesDeployment[] = [];
	let page = 1;

	for (;;) {
		const deploymentsPage = await callCfApi<CfListResponse<PagesDeployment>>(
			`/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments?env=preview&page=${page}`,
		);

		deployments.push(...deploymentsPage.result);

		console.log(
			"Fetched",
			deployments.length,
			"of",
			deploymentsPage.result_info.total_count,
		);

		if (deploymentsPage.result_info.total_count <= deployments.length) {
			break;
		}

		page++;
	}

	return deployments;
}

async function deletePagesDeployment(deploymentId: string): Promise<void> {
	await callCfApi(
		`/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments/${deploymentId}?env=preview&force=true`,
		"DELETE",
	);
}

async function callCfApi<T = unknown>(
	path: string,
	method = "GET",
	body: unknown = null,
): Promise<T> {
	let retries = 0;
	let delay = 1000;

	for (;;) {
		try {
			const response = await fetch(
				`https://api.cloudflare.com/client/v4${path}`,
				{
					method,
					headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
					body: body ? JSON.stringify(body) : null,
				},
			);

			if (!response.ok) {
				console.error(await response.json());
				throw new Error(
					`Failed to call Cloudflare API: ${response.statusText}`,
				);
			}

			return (await response.json()) as T;
		} catch (error) {
			if (retries === 3) {
				throw error;
			}
			console.log("Retrying in", delay, "ms");
			console.error(error);
			await new Promise((resolve) => setTimeout(resolve, delay));
			retries++;
			delay *= 2;
		}
	}
}
