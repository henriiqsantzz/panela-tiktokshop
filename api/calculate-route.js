// api/calculate-route.js
import axios from 'axios';
import jwt from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET || 'fallback_secret_change_me';
const CD_LOCATION = { lat: -23.5475, lng: -46.6361 }; // São Paulo - Brás

// Helper: ViaCEP
async function fetchViaCEP(cep) {
  const clean = cep.replace(/\D/g, '');
  const response = await axios.get(`https://viacep.com.br/ws/${clean}/json/`);
  if (response.data.erro) throw new Error('CEP não encontrado');
  return {
    logradouro: response.data.logradouro || '',
    bairro: response.data.bairro || '',
    cidade: response.data.localidade,
    uf: response.data.uf
  };
}

// Helper: Geocodificação via Nominatim (gratuito, sem chave)
async function geocodeNominatim(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=br`;
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'FreteUpsell/1.0' }
  });
  if (!response.data || response.data.length === 0) throw new Error('Geocode falhou');
  return {
    lat: parseFloat(response.data[0].lat),
    lng: parseFloat(response.data[0].lon)
  };
}

// Helper: Rota OSRM (polyline real)
async function getOSRMRoute(start, end) {
  const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=polyline`;
  const response = await axios.get(url);
  if (!response.data.routes || response.data.routes.length === 0) throw new Error('Rota não encontrada');
  const route = response.data.routes[0];
  return {
    polyline: route.geometry,
    distance_km: route.distance / 1000,
    duration_hours: route.duration / 3600
  };
}

export default async function handler(req, res) {
  // Permitir apenas POST e CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { cep, orderId } = req.body;
    if (!cep) return res.status(400).json({ error: 'CEP obrigatório' });

    // 1. ViaCEP
    const endereco = await fetchViaCEP(cep);
    const fullAddress = `${endereco.logradouro || 'Endereço'}, ${endereco.bairro || ''}, ${endereco.cidade} - ${endereco.uf}, Brasil`;

    // 2. Geocodificação do endereço completo
    let coords;
    try {
      coords = await geocodeNominatim(fullAddress);
    } catch (err) {
      // Fallback: geocodificar apenas cidade + UF
      coords = await geocodeNominatim(`${endereco.cidade}, ${endereco.uf}, Brasil`);
    }

    // 3. Rota OSRM
    const route = await getOSRMRoute(CD_LOCATION, coords);

    // 4. Preço do frete baseado na distância
    let priorityFee = 19.90;
    if (route.distance_km > 500) priorityFee = 29.90;
    if (route.distance_km > 1000) priorityFee = 49.90;

    // 5. Geração de JWT (validade 15 min)
    const tokenPayload = {
      orderId: orderId || `ORD_${Date.now()}`,
      cep: cep.replace(/\D/g, ''),
      priorityFee,
      distance_km: route.distance_km,
      exp: Math.floor(Date.now() / 1000) + (60 * 15)
    };
    const token = jwt.sign(tokenPayload, SECRET_KEY);

    // 6. Resposta completa
    res.status(200).json({
      status: 'success',
      logistics: {
        origin: { lat: CD_LOCATION.lat, lng: CD_LOCATION.lng, label: 'CD Paulista' },
        destination: {
          address: endereco.logradouro || '',
          neighborhood: endereco.bairro || '',
          city: endereco.cidade,
          state: endereco.uf,
          coords: { lat: coords.lat, lng: coords.lng },
          fullAddress
        },
        routing: {
          distance_km: Math.round(route.distance_km * 10) / 10,
          estimated_hours: Math.round(route.duration_hours * 10) / 10,
          geometry_polyline: route.polyline
        },
        pricing: {
          priority_fee: priorityFee,
          token
        }
      }
    });
  } catch (error) {
    console.error(error);
    // Fallback: retorna erro estruturado mas sem quebrar o frontend
    res.status(500).json({ error: 'Não foi possível calcular a rota. Tente novamente.' });
  }
}
