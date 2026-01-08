import axios from "axios";

function getDomain() {
  const d = process.env.SHIP_SHOP_DOMAIN;
  if (!d) throw new Error("Missing env SHIP_SHOP_DOMAIN");
  return d.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function getVersion() {
  return process.env.SHIP_API_VERSION || "2024-07";
}

function getToken() {
  const t = process.env.SHOPIFY_API_TOKEN;
  if (!t) throw new Error("Missing env SHOPIFY_API_TOKEN");
  return t;
}

export async function addCustomerTag({ customerGid, tag }) {
  const url = `https://${getDomain()}/admin/api/${getVersion()}/graphql.json`;

  const query = `
    mutation tagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }
  `;

  const resp = await axios.post(
    url,
    { query, variables: { id: customerGid, tags: [tag] } },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": getToken(),
      },
    }
  );

  if (resp.data?.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(resp.data.errors)}`);
  }

  const userErrors = resp.data?.data?.tagsAdd?.userErrors || [];
  if (userErrors.length) {
    throw new Error(`Shopify userErrors: ${JSON.stringify(userErrors)}`);
  }

  return resp.data?.data?.tagsAdd?.node?.id;
}
