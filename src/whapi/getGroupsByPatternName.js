import axios from "axios";

const get = async (token, patterName) => {
    const params = {
        count: 100,
        offSet: 0
    }

    const regex = new RegExp(patterName);

    try {
        let _continue = true;
        const groups = new Set();
        while (_continue){
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
            
            // Garantir extrair todos os grupos
            if (_resGroups.length < 100) {
                _continue = false;
            } else {
                params.offSet = params.offSet + params.count;
            }
        }
        
        return Array.from(groups);

    } catch (err) {
        throw err;
    }
}

export default get;