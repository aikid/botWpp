import axios from "axios";

const get = async (token, patterName) => {
    const params = {
        count: 1,
        offSet: 0
    }

    const regex = new RegExp(patterName);

    try {
        const groups = new Set();

        const firsRes = await axios.get("https://gate.whapi.cloud/groups", {
        headers: { 
            accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        params: params
        });

        params.count = firsRes.data.total;

        const res = await axios.get("https://gate.whapi.cloud/groups", {
        headers: { 
            accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        params: params
        });

        const _resGroups = res.data.groups;

        _resGroups.filter( row => regex.test(row.name))
            .forEach(row => {
                groups.add(row.id);
            });
        
        return Array.from(groups);

    } catch (err) {
        throw err;
    }
}

export default get;