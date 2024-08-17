const LIVEBOX_BASE_URL = process.env.LIVEBOX_BASE_URL;
const LIVEBOX_USER = process.env.LIVEBOX_USER;
const LIVEBOX_PASSWORD = process.env.LIVEBOX_PASSWORD;
const LIVEBOX_PASSWORD_HASH = process.env.LIVEBOX_PASSWORD_HASH;
const LIVEBOX_LOGIN_PATH = "/login.cgi";
const LIVEBOX_NETWORK_CONNECTED_PATH = "/cgi/cgi_network_connected.js";
const METRICS_API_URL = process.env.METRICS_API_URL;

const retries = 0;
const metrics = [];

tryGetConnectedDevices();

async function tryGetConnectedDevices(retry = false) {
  if (retry) {
    retries++;

    if (retries === 3) {
      return;
    }
  }

  await login()
    .then((urn) => getConnectedDevices(urn))
    .catch((error) => {
      console.error("An error occurred:", error);
      doLogic(true);
    });
}

async function login() {
  const bodyParams = new URLSearchParams({
    GO: "status.htm",
    pws: LIVEBOX_PASSWORD_HASH,
    usr: LIVEBOX_USER,
    ui_pws: LIVEBOX_PASSWORD,
    login: "acceso",
  });

  return fetch(LIVEBOX_BASE_URL + LIVEBOX_LOGIN_PATH, {
    method: "POST",
    body: bodyParams.toString(),
  })
    .then((response) => response.text())
    .then((responseText) => {
      const urn = responseText.split("'")[1];
      return urn;
    })
    .catch((error) => {
      console.error("Login failed:", error);
    });
}

async function getConnectedDevices(urn) {
  const headers = {
    Cookie: `urn=${urn}`,
  };

  return fetch(LIVEBOX_BASE_URL + LIVEBOX_NETWORK_CONNECTED_PATH, {
    method: "GET",
    headers,
  })
    .then((response) => response.text())
    .then((responseText) => eval(responseText))
    .catch((error) => {
      console.error("Failed to get connected devices:", error);
    });
}

// Hack for eval - parse configuration array
let pending = true;

export function parseCfgAry(data) {
  if (pending) {
    parseConnectedDevices(data);
    pending = false;
  }

  return {
    toDimension: () => {},
  };
}

// Hack for eval - String prototype unescape method
String.prototype.unescape = function () {
  return "";
};

function parseConnectedDevices(devices) {
  for (const device of devices) {
    if (mustSkipDevice(device)) {
      continue;
    }

    parseDevice(device);
  }

  // Log metrics
  console.log(metrics);

  // Send metrics
  sendConnectedDeviceMetric();
}

function mustSkipDevice(device) {
  if (device === null) {
    return true;
  }

  if (isDeviceInactive(device)) {
    return true;
  }

  return false;
}

function isDeviceInactive(device) {
  if (device.activity === "1") {
    return false;
  }

  const timeLastActive = new Date(
    decodeURIComponent(device["time_last_active"])
  );

  const currentDate = Date.now();
  const inactiveDuration = 60 * 60 * 1000;

  if (currentDate - timeLastActive.getTime() > inactiveDuration) {
    return true;
  }

  return false;
}

function parseDevice(device) {
  if (device.name.includes("unknown")) {
    device.friendlyName = decodeURIComponent(device.ip);
  } else {
    device.friendlyName = decodeURIComponent(device.name);
  }

  const metric = createMetric(device);
  metrics.push(metric);
}

function createMetric(device) {
  return {
    kind: "gauge",
    name: "local_network_device",
    labels: {
      name: device.friendlyName,
    },
    value: device.activity,
  };
}

async function sendConnectedDeviceMetric() {
  const body = JSON.stringify({ metrics });

  fetch(METRICS_API_URL, {
    method: "POST",
    body,
  })
    .then((response) => {
      if (response.ok === false) {
        console.error(
          "Failed to send metrics due to bad status code ",
          response.statusText
        );
      }
    })
    .catch((error) => {
      console.error("Error sending metrics:", error);
    });
}
